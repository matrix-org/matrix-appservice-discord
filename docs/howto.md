
### Join a room

The default format for room aliases (which are automatically resolved, whether the room exists on Matrix or not) is:

``#_discord_guildid_channelid``

You can find these on discord in the browser where:

``https://discordapp.com/channels/282616294245662720/282616372591329281``

is formatted as https://discordapp.com/channels/``guildid``/``channelid``

### Set privileges on bridge managed rooms

* The ``adminme`` script is provided to set Admin/Moderator or any other custom power level to a specific user.
* e.g. To set Alice to Admin on her ``example.com`` HS on default config. (``config.yaml``)
  * ``npm run adminme -- -r '!AbcdefghijklmnopqR:example.com' -u '@Alice:example.com' -p '100'``
  * Run ``npm run adminme -- -h`` for usage.
