import {Browser, firefox, Page} from "playwright";
import {TwitterOpenApi, TwitterOpenApiClient} from "twitter-openapi-typescript";
import {Tweet} from "twitter-openapi-typescript-generated";

const email = '00boilers-gutsy@icloud.com';
const password = 'password1234';
const handle = '@ScroogeMcD1995';

class TweetHarvester {
    constructor(private browser: Browser, private client: TwitterOpenApiClient) {

    }

    async search(keyword: string) {
        console.log("searching for", keyword);
        const response = await this.client.getTweetApi().getSearchTimeline({rawQuery: keyword});
        console.log("got response", response.header)

        return Promise.allSettled(Array.from(response.data.data.entries()).map(async ([index, {tweet}]) => {
            const id = tweet.restId;
            console.log("scraping tweet", id, "index", index, "keyword", keyword);

            console.log("getting favoriters");
            const favoritersResponse = await this.client.getUserListApi().getFavoriters({tweetId: id, count: 1000});
            console.log("got favorites response", favoritersResponse.header);

            const favoriters = Array.from(favoritersResponse.data.data.entries()).map(([index, {user}]) => {
                return user?.restId
            });

            console.log("getting retweeters");
            const retweetersResponse = await this.client.getUserListApi().getRetweeters({tweetId: id, count: 1000});
            const retweeters = Array.from(retweetersResponse.data.data.entries()).map(([index, {user}]) => {
                return user?.restId
            });
            console.log("got retweeters response", favoritersResponse.header);

            // quotes are queried using searchTimeline

            return {
                keyword,
                index,
                id,
                text: tweet.legacy?.fullText,
                stats: getStats(tweet),
                favoriters,
                retweeters
            }
        }));
    }


    async dispose() {
        await this.browser.close();
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

        const client = await getClient(ct0, authToken);

        return new TweetHarvester(browser, client);

    } finally {
        await context.tracing.stop({path: 'trace.zip'});
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


const harvester = await authenticate(email, handle, password);
const res = await harvester.search('ביבי');
console.log(JSON.stringify(res, null, 2));
await harvester.dispose();