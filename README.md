# Matrix Discord Bridge

A bridge between [Matrix](http://matrix.org/) and [Discord](https://discordapp.com/).
Currently the bridge is alpha quality, but is usable.

![Screenshot of Riot and Discord working together](screenshot.png)

## Helping out

[![Build Status](https://travis-ci.org/Half-Shot/matrix-appservice-discord.svg?branch=develop)](https://travis-ci.org/Half-Shot/matrix-appservice-discord)

### PRs
PRs are graciously accepted, so please come talk to us in [#discord-bridge:matrix.org](https://matrix.to/#/#discord-bridge:matrix.org)
about any neat ideas you might have. If you are going to make a change, please merge it with the `develop` branch :).

### Issues
You can also file bug reports/ feature requests on Github Issues which also helps a ton. Please remember to include logs.
Please also be aware that this is an unoffical project worked on in my (Half-Shot) spare time.

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
In a vague order of what is coming up next

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
 - [ ] Third Party Lookup
  - [x] Rooms
  - [ ] Users
 - [ ] Puppet a user's real Discord account.
 - [ ] Rooms react to Discord updates
 - [ ] Integrate Discord into existing rooms.
 - [ ] Manage channel from Matrix
  - [ ] Authorise admin rights from Discord to Matrix users
  - [ ] Topic
  - [ ] Room Name (possibly)
 - [ ] Provisioning API
 - [ ] Webhooks (allows for prettier messages to discord)
 - [ ] VOIP (**Hard** | Unlikely to be finished anytime soon)


## Contact

My Matrix ID: [@Half-Shot:half-shot.uk](https://matrix.to/#/@Half-Shot:half-shot.uk)
