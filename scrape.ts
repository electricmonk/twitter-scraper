import {Browser, firefox, Page} from "playwright";
import {TweetApiUtilsData, TwitterOpenApi, TwitterOpenApiClient} from "twitter-openapi-typescript";
import {Tweet} from "twitter-openapi-typescript-generated";
import * as fs from "fs";

const email = '00boilers-gutsy@icloud.com';
const password = 'password1234';
const handle = '@ScroogeMcD1995';

type ScrapedTweet = {
    keyword: string;
    id: string;
    text: string | undefined;
    stats: ReturnType<typeof getStats>
    favoriters: Array<string | undefined>,
    retweeters: Array<string | undefined>,
    quotes: Array<ScrapedTweet>
}

class TweetHarvester {
    constructor(private client: TwitterOpenApiClient) {

    }

    async search(keyword: string) {
        const scrapedTweets: ScrapedTweet[] = [];
        let cursor: string | undefined = undefined;
        console.log("searching for", keyword);
        while (true) {
            try {
                const response = await this.client.getTweetApi().getSearchTimeline({
                    rawQuery: keyword,
                    cursor,
                    product: "Top"
                });
                const results = Array.from(response.data.data.entries());

                const rateLimitRemainining = response.header.rateLimitRemaining;
                console.log("search for", keyword, "got response size:", results.length, "rateLimitRemaining", rateLimitRemainining);

                const tweets = await Promise.allSettled(results.map(([_, t]) => this.scrapeTweet(t)));
                tweets.forEach(t => {
                    if (t.status === 'fulfilled') {
                        scrapedTweets.push(t.value);
                    } else {
                        console.error(t.reason);
                    }
                });

                if (results.length === 0) {
                    console.log("got no results, ending");
                    break;
                }

                if (rateLimitRemainining === 0) {
                    console.log("reached rate limit, ending");
                    break;
                }

                if (response.data.cursor.bottom) {
                    cursor = response.data.cursor.bottom.value;
                } else {
                    console.log("got to end of search results")
                    break;
                }

            } catch (e: any) {
                if (e.response?.status === 429) {
                    console.log("got rate limited, retry later");
                    break;
                }
                console.error(e);
            }
        }

        console.log("got a total of", scrapedTweets.length, "tweets");

        return scrapedTweets;

    }


    private async scrapeTweet({tweet}: TweetApiUtilsData): Promise<ScrapedTweet> {
        const id = tweet.restId;
        const [
            favoriters,
            retweeters,
            quotes
        ] = await Promise.all([
            this.getFavoriters(id),
            this.getRetweeters(id),
            this.search(`quoted_tweet_id:${id}`),
        ]);

        // quotes are queried using searchTimeline

        return {
            keyword,
            id,
            text: tweet.legacy?.fullText,
            stats: getStats(tweet),
            favoriters,
            retweeters,
            quotes
        }
    };

    private async getRetweeters(id: string) {
        console.log("getting retweeters for tweet", id);
        const retweetersResponse = await this.client.getUserListApi().getRetweeters({tweetId: id, count: 1000});
        const retweeters = Array.from(retweetersResponse.data.data.entries()).map(([index, {user}]) => {
            return user?.restId
        });
        console.log("got", retweeters.length, "retweeters");
        return retweeters;
    }

    private async getFavoriters(id: string) {
        console.log("getting favoriters for tweet", id);
        const favoritersResponse = await this.client.getUserListApi().getFavoriters({tweetId: id, count: 1000});
        const favoriters = Array.from(favoritersResponse.data.data.entries()).map(([index, {user}]) => {
            return user?.restId
        });
        console.log("got", favoriters.length, "favoriters");
        return favoriters;
    }
}

async function authenticate(email: string, handle: string, password: string) {
    console.log("launching browser");
    const browser = await firefox.launch({headless: true, slowMo: 200});
    const context = await browser.newContext();
    await context.tracing.start({screenshots: true, snapshots: true});
    try {

        const page = await context.newPage();

        console.log("logging in");
        await login(page, email, handle, password);

        console.log("waiting for cookies");
        await new Promise(res => setTimeout(res, 1000));

        const storage = await page.request.storageState();
        const ct0 = storage.cookies.find(c => c.name === 'ct0')?.value;
        const authToken = storage.cookies.find(c => c.name === 'auth_token')?.value;
        if (!ct0 || !authToken) {
            throw new Error("no cookies");
        }
        await browser.close();

        const client = await getClient(ct0, authToken);


        return new TweetHarvester(client);

    } catch (e) {
        await context.tracing.stop({path: 'trace.zip'});
        throw e;
    }

}

async function login(page: Page, email: string, handle: string, password: string) {
    await page.goto('https://twitter.com/login');
    await page.fill('input', email);
    await page.getByText('Next').click();
    console.log("typed email");

    try {
        // if Twitter suspects we're a bot, it requires us to enter the handle as well
        await page.getByTestId('ocfEnterTextTextInput').fill(handle, {timeout: 2000});
        await page.getByText('Next').click();
        console.log("typed handle");

    } catch {
        // do nothing on purpose
    }

    await page.fill('input[name=password]', password);
    console.log("typed password");

    await page.getByText('Log in').click();
    console.log("clicked login");
}

const getClient = async (ct0: string, authToken: string) => {
    const api = new TwitterOpenApi({fetchApi: fetch as any});
    return await api.getClientFromCookies(ct0, authToken);
};


function getStats(tweet: Tweet) {
    return {
        views: tweet.views.count,
        replies: tweet.legacy?.replyCount,
        quotes: tweet.legacy?.quoteCount,
        retweets: tweet.legacy?.retweetCount,
        favorites: tweet.legacy?.favoriteCount,
    }
}


const keyword = 'Gaza';
const harvester = await authenticate(email, handle, password);
const res = await harvester.search(keyword);
fs.writeFileSync(`${keyword}.json`, JSON.stringify(res, null, 2));