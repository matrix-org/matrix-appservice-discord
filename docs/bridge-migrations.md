# 1.0 Migration (from 0.5.1 or lower)

If you have been linked here, there is an issue with your config on your bridge.

Please follow the following steps:

1. If you have just created a new install OR were previously running 0.5.X,
   please remove `roomDataStore` and `userDataStore` from your config file.
2. If this is a existing install but you have not run 0.5.X (0.4.X or lower),
   please downgrade to 0.5.X to migrate your database across and then run
   this version of the bridge again.
