/*
Copyright 2018, 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

export interface IMatrixEventContent {
    body?: string;
    info?: any; // tslint:disable-line no-any
    name?: string;
    topic?: string;
    membership?: string;
    msgtype?: string;
    url?: string;
    displayname?: string;
    reason?: string;
    "m.relates_to"?: any; // tslint:disable-line no-any
}

// export interface IMatrixEvent {
//     event_id: string;
//     state_key: string;
//     type: string;
//     sender: string;
//     room_id: string;
//     membership?: string;
//     avatar_url?: string;
//     displayname?: string;
//     redacts?: string;
//     replaces_state?: string;
//     content?: IMatrixEventContent;
//     unsigned?: any; // tslint:disable-line no-any
//     origin_server_ts?: number;
//     users?: any; // tslint:disable-line no-any
//     users_default?: any; // tslint:disable-line no-any
//     notifications?: any; // tslint:disable-line no-any
// }

// export interface IMatrixUnsignedData {
//     age: number;
//     redacted_because: IMatrixEvent;
//     transaction_id: string;
// }

export interface IMatrixEvent {
    content: object;
    type: string;
    unsigned: {
        age: number,
        prev_content?: any,
    };
}

export interface IMatrixRoomEvent extends IMatrixEvent {
    room_id: string;
    event_id: string;
    content: {
        "m.relates_to"?: any;
    };
}

export interface IMatrixStateEvent extends IMatrixRoomEvent {
    sender: string;
    state_key: string;
}

export interface IMatrixRoomEventName extends IMatrixStateEvent {
    type: "m.room.name";
    content: { name: string, "m.relates_to"?: any };
}

interface IMemberContentType {
    displayname: string | null;
    membership: "invite"|"join"|"leave"|"ban"|"knock";
    reason?: string;
    "m.relates_to"?: any;
}

export interface IMatrixRoomEventMember extends IMatrixStateEvent {
    type: "m.room.member";
    content: IMemberContentType;
    replaces_state: string;
    displayname: string | null; // TODO[V02460]: Are these two right?
    avatar_url: string;
    unsigned: {
        age: number,
        prev_content?: IMemberContentType,
    };
}

export interface IMatrixRoomEventTopic extends IMatrixStateEvent {
    type: "m.room.topic";
    content: { topic: string, "m.relates_to"?: any };
}

export interface IMatrixMessageEvent extends IMatrixRoomEvent {
    type: "m.room.message";
    sender: string;
    content: {
        // TODO[V02460]: Tighten types
        body: string,
        msgtype: string,
        info: any,
        url?: string,
        "m.relates_to"?: any,
    };
}

export interface IMatrixRedactionEvent extends IMatrixRoomEvent {
    type: "m.room.redaction";
    sender: string;
    content: {body: string, msgtype: string, "m.relates_to"?: any };
    redacts: string;
}

export interface IMatrixEncryptionEvent extends IMatrixStateEvent {
    type: "m.room.encryption";
    content: {
        algorithm: string,
        rotation_period_ms: number,
        rotation_period_msgs: number,
        "m.relates_to"?: any,
    };
}

export interface IMatrixPowerLevelsEvent extends IMatrixStateEvent {
    type: "m.room.power_levels";
    users_default: number;
    users: { [id: string]: number };
}

// TODO[V02460]: Tighten types
type IImageInfo = any;

export interface IMatrixStickerEvent extends IMatrixRoomEvent {
    type: "m.sticker";
    sender: string;
    content: { body: string, info: IImageInfo, url: string, "m.relates_to"?: any };
}

export type MatrixStateEventType = (
    | IMatrixEncryptionEvent
    | IMatrixPowerLevelsEvent
    | IMatrixRoomEventMember
    | IMatrixRoomEventName
    | IMatrixRoomEventTopic
);
export type MatrixMessageEventType = (
    | IMatrixMessageEvent
    | IMatrixRedactionEvent
    | IMatrixStickerEvent
);
export type MatrixRoomEventType = MatrixStateEventType | MatrixMessageEventType;

export function isMatrixRoomEvent(event: IMatrixEvent): event is MatrixRoomEventType {
    return (event as MatrixRoomEventType).room_id !== undefined;
}

export interface IMatrixMessage {
    body: string;
    msgtype: string;
    formatted_body?: string;
    format?: string;
}

export interface IMatrixMediaInfo {
    w?: number;
    h?: number;
    mimetype: string;
    size: number;
    duration?: number;
}
