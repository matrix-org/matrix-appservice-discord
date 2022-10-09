import { MockTextChannel } from './channel';
import { MockEmoji } from './emoji';
import { MockMessage } from './message';

/* tslint:disable:no-unused-expression max-file-line-count no-any */
export class MockReaction {
    public message: MockMessage;
    public emoji: MockEmoji;
    public channel: MockTextChannel;

    constructor(message: MockMessage, emoji: MockEmoji, channel: MockTextChannel) {
        this.message = message;
        this.emoji = emoji;
        this.channel = channel;
    }
}
