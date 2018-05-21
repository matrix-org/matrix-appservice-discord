## Welcome!

Hello! It's awesome that you want to contribute to the Discord bridge, by doing
so you are helping our users and the wider Matrix ecosystem. This document
lists the requirements for your work to be accepted into our repository.

For clarity reasons, work can either be a pull request or an issue. We find
both quite valuable to the project. One last thing before we begin is that you
must abide by our licence, which is listed in LICENCE and is the Apache 2
licence.

Most importantly we are a welcoming project and will be happy to review any
works, no matter the skill level of the submitter. Everyone must start
somewhere and if you feel you are somewhat confident in being able to help then
we are doing our jobs properly!

## Quickfire tips (or TL;DR)

* Always work off the **develop** branch. We won't accept merges into any other branch except from special occasions.
* We follow the [Matrix Code of Conduct](https://matrix.org/docs/guides/code_of_conduct.html) and will not accept or entertain works from individuals who break it. We believe in considerate and respectful members above accepting works, regardless of quality.
  * This includes possible bans from any room(s) involved with the project.
* We are limited to accepting work over Github. Please use its interface when submitting work items.
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
inside the ``MatrixEventProcessor`` class.

## Setting up

(This section needs to be written in detail)

* You will need to [setup the bridge](https://github.com/Half-Shot/matrix-appservice-discord/tree/develop#setup-the-bridge) similarly to how we describe,
  but you should setup a homeserver locally on your development machine. We would recommend [Synapse](https://github.com/matrix-org/synapse#id11).

## Writing an issue

When writing an issue, please be as verbose as you can. Remember the issue is
there to either document a feature request, or report a bug so it can be fixed.
The issue board is NOT there to complain about a broken or missing feature.

We leave it to the author's disgression to decide what to include rather than
provide a template, but good items are:
 * Shorter titles are better than long rambling ones, but please don't make it too vague.
    * A good example is "Ability to bridge an existing matrix room to a discord channel"
 * A brief description of the problem.
 * Relevant logging from Synapse/your homeserver AND the bridge.
    * If you are a user of another person's bridge, please can you give the name of that person or homeserver.
    * The more verbose, the better but please don't include sensitive details like access tokens.
      If you must, please PM Half-Shot discreetly.
 * A screenshot.

We will assign each issue a tag, which will allow us to categorise the problems.

Demands from users to fix issues on any kind of time scale, without a very good
reason is not tolerated and will not help your issue to get fixed quicker. The
Code of Conduct linked above also applies to issues and we will take any
complaints very seriously.

Please bear with us as we get to your issue, the project runs without any
external funding or support except from the work of the community and as such
offer no on-demand support or feature development.


## PR Process

We've tried our best to keep the PR process relatively simple:

* Create a new branch off develop and name it ``yourusernameoridentifer/featurename``.
    * This can be done with ``git checkout develop`` followed by ``git checkout -b yourusernameoridentifer/featurename``.
* Create a PR on Github, making sure to give a brief discription of your changes and link to the issue it fixes, if any.
    * If your change is not complete but you would like feedback, prepend ``[WIP]`` to the title.
* Ensure the linter and tests are not failing, as we will not accept code that breaks either.
    * If your tests fail and are having trouble fixing them, you may push your changes and we will help you fix them.
    * Github automatically pokes TravisCI to run both linting and tests.
* Someone from the community will review your work and decide what to do with the PR.
    * We may decide to reject it, if a feature has little chance of fitting in with the project goals.
    * Usually we will have feedback for the PR and will submit more comments.


## Testing

Testing the bridge is easy enough, you just need to run ``npm run build``,
``npm run lint`` and ``npm test``. If all pass without errors, congratulations!

Please bear in mind that you will need to cover the whole, or a reasonable
degree of your code. You can check to see if you have with ``npm run
coverage``.
