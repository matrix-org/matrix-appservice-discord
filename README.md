# matrix-appservice-discord

A bridge between [Matrix](http://matrix.org/) and [Discord](https://discordapp.com/).
Currently the bridge is alpha quality, but is usable.

![Screenshot of Riot and Discord working together](screenshot.png)

## Setting up

(These instructions were tested against Node.js v6.9.5 and the Synapse homeserver)

### Setup the bridge

* Run ``npm install`` to grab the dependencies.
* Run ``npm build`` to build the typescript.
* Copy ``config/config.sample.yaml`` to ``config.yaml`` and edit it to reflect your setup.
* Run ``node build/discordas.js -r -u "http://localhost:9005/" -c config.yaml``
* Modify your HSs appservices config so that it includes the generated file.

### Setting up Discord

* Create a new application via https://discordapp.com/developers/applications/me/create
* Make sure to create a bot user. Fill in ``config.yaml``
* Run ``npm run-script getbotlink`` to get a authorisation link.
* Give this link to owners of the guilds you plan to bridge.
* Finally, you can join a room with ``#_discord_GuildName#channelname``
  * Where the guild name has the spaces replaced with ``-``.  

## Features and Roadmap

 - [x] Group messages
 - [ ] Direct messages
  - [ ] Recieving
  - [ ] Initiating
 - Matrix -> Discord
   - [x] Text content
   - [x] Image content
   - [x] Audio/Video content
   - [ ] Typing notifs (**Not supported, requires syncing**)
   - [x] User Profiles
 - Discord -> Matrix
   - [x] Text content
   - [x] Image content
   - [x] Audio/Video content
   - [x] Typing notifs
   - [x] User Profiles
   - [x] Presence (Synapse currently squashes presence, waiting on future spec)
 - [ ] Webhooks (allows for prettier messages to discord)
 - [ ] Rooms react to Discord updates
 - [ ] Manage channel from Matrix
 - [ ] VOIP (**Hard** | Unlikely to be finished anytime soon)

## Contact

My Matrix ID: [@Half-Shot:half-shot.uk](https://matrix.to/#/@Half-Shot:half-shot.uk)
