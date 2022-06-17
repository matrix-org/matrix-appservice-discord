Hi there! Please read the [CONTRIBUTING.md](https://github.com/matrix-org/matrix-appservice-bridge/blob/develop/CONTRIBUTING.md) guide for all matrix.org bridge
projects.

## matrix-appservice-discord Guidelines

* Discussion of ideas for the bridge and work items should be in [#discord:half-shot.uk](https://matrix.to/#/#discord:half-shot.uk).
* Everything submitted as a PR should have at least one test, the only exception being non-code items.

## Overview of the Bridge

The bridge runs as a standalone server that connects to both the Discord API
network and a local Matrix homeserver over the [application service
protocol](https://matrix.org/docs/spec/application_service/unstable.html).
Primarily it syncs events and users from Matrix to Discord and vice versa.

While the bridge is constantly evolving and we can't keep this section updated
with each component, we follow the principle of handler and processor classes
and each part of the functionality of the bridge will be in a seperate class.
For example, the processing of Matrix events destined for Discord are handled
inside the `MatrixEventProcessor` class.

## Setting up

* You will need to [setup the bridge](https://github.com/Half-Shot/matrix-appservice-discord/tree/develop#setup-the-bridge) similarly to how we describe,
  but you should setup a homeserver locally on your development machine. We would recommend [Synapse](https://github.com/matrix-org/synapse).
* The bridge uses `yarn` for dependency management and package scripts instead of `npm`.
  For details, view the full setup instructions in the [README](README.md#set-up-the-bridge).

## Testing

CI will lint and test your code automatically,
but you can save yourself some time by checking locally before submitting code.
Refer to the main matrix.org bridge contributing guide for instructions on how to
[lint](https://github.com/matrix-org/matrix-appservice-bridge/blob/develop/CONTRIBUTING.md#%EF%B8%8F-code-style) and
[test](https://github.com/matrix-org/matrix-appservice-bridge/blob/develop/CONTRIBUTING.md#-tests--ci).

Please bear in mind that you will need to cover the whole, or a reasonable
degree of your code. You can check to see if you have with `yarn coverage`.
