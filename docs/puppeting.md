# Puppeting

This docs describes the method to puppet yourself with the bridge, so you can
interact with the bridge as if you were using the real Discord client. This
has the benefits of (not all of these may be implemented):
 * Talking as yourself, rather than as the bot.
 * DM channels
 * Able to use your Discord permissions, as well as joining rooms limited to
   your roles as on Discord.

## Caveats & Disclaimer

Discord is currently __not__ offering any way to authenticate on behalf
of a user _and_ interact on their behalf. The OAuth system does not allow
remote access beyond reading information about the users. While [developers have
expressed a wish for this](https://feedback.discordapp.com/forums/326712-discord-dream-land/suggestions/16753837-support-custom-clients)
,it is my opinion that Discord are unlikely to support this any time soon. With
all this said, Discord will not be banning users or the bridge itself for acting
on the behalf of the user.

Therefore while I loathe to do it, we have to store login tokens for *full
permissions* on the user's account (excluding things such as changing passwords
  and e-mail which require re-authenication, thankfully).

The tokens will be stored by the bridge and are valid until the user
changes their password, so please be careful not to give the token to anything
that you wouldn't trust with your password.

I accept no responsibility if Discord ban your IP, Account or even your details on
their system. They have never given official support on custom clients (and
  by extension, puppeting bridges). If you are in any doubt, stick to the
  bot which is within the rules.

## How to Puppet an Account
*2FA does not work with bridging, please do not try it.*

* Go to [Discord](https://discordapp.com/channels/@me) on your *browser* and log
  in if you haven't.
* Open the developer console (On Firefox/Chrome this is Shift+Control+C)
* Click Storage or Application if it is not already selected.
* On the left hand side there will be an option for "Local Storage", find this
  and expand it and then click on the Discord option.
* Find the option for token on the right hand side and copy the value, excluding
  the `"`s
* ~~Start a conversation with ``@_discord_bot:yourdomain`` on Matrix and send
  the message "account.link Your_Token"~~
* ~~The bridge should reply once it's managed to log you in.~~
* Bot control has not been implemented yet, for now you will need to edit the
  database and fill in user_tokens with your userId and token.
* Congratulations, you are now puppeted.
