### Troubleshooting your Discord Bot

So you've got the bridge running and the Discord bot invited to the
server you want to bridge to, but the bridge isn't sending messages from
Matrix to Discord? First, do a santiy check and create a fresh Discord server,
invite the bot to it, and see if you can send messages back and forth. If it's
working on a fresh server, you might be encountering issues with how permissions
are calculated in Discord. Permissions for a given guild/channel/role are
calculated as follows:

1. Base permissions given to `@everyone` are applied at a guild level
2. Permissions allowed to a user by their roles are applied at a guild level
3. Overwrites that deny permissions for @everyone are applied at a channel level
4. Overwrites that allow permissions for @everyone are applied at a channel level
5. Overwrites that deny permissions for specific roles are applied at a channel level
6. Overwrites that allow permissions for specific roles are applied at a channel level
7. Member-specific overwrites that deny permissions are applied at a channel level
8. Member-specific overwrites that allow permissions are applied at a channel level

There are several scenarios that will prevent communication from Matrix to Discord.
Here's what's been identified so far and how to fix them.

- The `@everyone` role denies `Manage Webhooks` at the guild level.
  Remove the denial.
- In the channel, a certain role is required to send messages.
  This is tricky. If the required role is applied to the bot, it may seem like
  the bot has the role. However, the way roles work is that you only get the permissions
  of the "lowest" role, and bots automatically start as the lowest role. In the roles
  UI for a guild, roles are listed from lowest to highest. To be able to give the
  permissions of a required role to a bot, the bot role must be lower in the list (which
  means higher in position) then the required role.
- The `@everyone` role denies `Manage Webhooks` at the channel level
  Remove the denial.

Other scenarios should be variations of these.
