type RouteCallback = (path: string, cb: (req: IRequest, res: IResponse) => void|Promise<void>) => void;

export interface IApplication {
    get: RouteCallback;
    put: RouteCallback;
    post: RouteCallback;
}

export interface IRestApi {
    bindEndpoints: (app: IApplication) => void;
}

export interface IRequest<T> {
    params: {[key: string]: string};
    body: T;
}

export interface IResponse {
    // tslint:disable-next-line: no-any
    json: (body: any) => void;
    status: (statusCode: number) => IResponse;
}
