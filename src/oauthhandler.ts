import { DiscordBridgeConfigAuth } from "./config";
import { Bridge } from "matrix-appservice-bridge";
import {Request, Response} from "express";
import { Log } from "./log";
import * as uuid from "uuid/v4";
import * as request from "request-promise-native";
import { DiscordStore } from "./store";
import { DbAccessToken } from "./db/dbaccesstoken";

const log = new Log("OAuthHandler");

const URL_AUTH = "https://discordapp.com/api/oauth2/authorize";
const URL_TOKEN = "https://discordapp.com/api/oauth2/token";
const URL_REVOKE = "https://discordapp.com/api/oauth2/token/revoke";
const URL_IDENTITY = "https://discordapp.com/api/users/%40me";

const HTTP_UNAUTHORISED = 401;
const HTTP_INTERNAL_ERROR = 500;

interface IDiscordTokenResponse {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
    token_type: string;
}

/**
 * This class handles OAuth identification for matching
 * Discord users to Matrix accounts.
 */
export class OAuthHandler {
    private stateUserMap: Map<string, string>;
    constructor(private config: DiscordBridgeConfigAuth, private bridge: Bridge, private store: DiscordStore) {
        this.stateUserMap = new Map();
    }

    public bindEndpoint() {
        this.bridge.addAppServicePath({
            handler: (req: Request, res: Response) => {
                this.onGetOAuth(req, res).catch((ex) => {
                    log.error("Failure during oauth:", ex);
                    if (res.finished) {
                        return;
                    }
                    res.sendStatus(HTTP_INTERNAL_ERROR);
                });
            },
            method: "GET",
            path: "/_bridge/oauth",
        });
        log.info("Bound _bridge/oauth for oAuth");
    }

    public handleOAuthRequest(userid: string) {
        // 1. Get the userId
        const stateKey = uuid();
        this.stateUserMap.set(stateKey, userid);
        const url = `${this.authUrl}&state=${stateKey}`;
        return url;
    }

    public async onGetOAuth(req: Request, res: Response) {
        const userId = this.stateUserMap.get(req.query.state);
        if (!userId) {
            log.warn("Ignorning oauth request for unknown user");
            res.status(HTTP_UNAUTHORISED).send("Error: User not found");
            return;
        }
        log.info("Got OAuth Request for", userId);
        const formData = {
            client_id: this.config.clientID,
            client_secret: this.config.clientSecret,
            code: req.query.code,
            grant_type: "authorization_code",
            redirect_uri: this.config.oAuthUrl,
            scope: this.scopes(),
        };
        try {
            // Tslint fails to recognise these as promises.
            /* tslint:disable-next-line await-promise */
            const atRes = JSON.parse(await (request.post({
                formData,
                simple: true,
                url: URL_TOKEN,
            }))) as IDiscordTokenResponse;
            const dataObj = new DbAccessToken();
            dataObj.DiscordId = await this.getIdentity(atRes.access_token);
            dataObj.AccessToken = atRes.access_token;
            dataObj.RefreshToken = atRes.refresh_token;
            dataObj.ExpiresIn = atRes.expires_in || 0;
            dataObj.MatrixId = userId;
            await this.store.Insert(dataObj);
        } catch (ex) {
            log.warn("Got error when trying to get token:", ex.message);
            res.status(HTTP_INTERNAL_ERROR).send("Error: Unknown error");
            return;
        }
        res.send("Your Discord account has been linked to this bridge instance. You may close this page.");
        // TODO: We could trigger a power level update for any guilds this user is in.
    }

    private async getIdentity(accessToken: string) {
        /* tslint:disable-next-line await-promise */
        const ident = await request.get({
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            json: true,
            simple: true,
            url: URL_IDENTITY,
        });
        return ident.id;
    }

    private scopes(escape: boolean = false) {
        return ["identify", "guilds", "guilds.join"].join(escape ? "%20" : " ");
    }

    private get authUrl() {
        return `${URL_AUTH}?client_id=${this.config.clientID}&response_type=code` +
        `&redirect_uri=${this.config.oAuthUrl}&scope=${this.scopes(true)}`;
    }
}
