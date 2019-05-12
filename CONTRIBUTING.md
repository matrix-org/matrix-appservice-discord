Hello! It's awesome that you want to contribute to the Discord bridge, by doing
so you are helping our users and the wider Matrix ecosystem. This document
lists the requirements for your work to be accepted into our repository.

For clarity reasons, work can either be a pull request or an issue. We find
both quite valuable to the project. Please note that your work must abide by
the Apache 2 license found in the LICENSE file.

Most importantly we are a welcoming project and will be happy to review any
works, no matter the skill level of the submitter. Everyone must start
somewhere!

## TL;DR

* Always work off the **develop** branch. We won't accept merges into any other branches.

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
inside the `MatrixEventProcessor` class.

## Setting up

* You will need to [setup the bridge](https://github.com/Half-Shot/matrix-appservice-discord/tree/develop#setup-the-bridge) similarly to how we describe,
  but you should setup a homeserver locally on your development machine. We would recommend [Synapse](https://github.com/matrix-org/synapse#id11).

## Writing an issue

When writing an issue, please be as verbose as you can. Remember the issue is
there to either document a feature request, or report a bug so it can be fixed.
The issue board is NOT there to complain about a broken or missing feature.

We leave it to the author's discretion to decide what to include rather than
provide a template, but good items are:
 * Shorter titles are better than long rambling ones, but please don't make it too vague.
    * A good example is "Ability to bridge an existing matrix room into a discord channel"
 * A brief description of the problem.
    * If you are a user of another person's bridge, please can you let us know the name of the service provider.
    * If you would like to keep the details private, please PM @Half-Shot:half-shot.uk or @sorunome:sorunome.de discreetly.
 * Relevant logging from Synapse/your homeserver AND the bridge (if applicable).
    * The more verbose, the better but please don't include sensitive details like access tokens.
 * A screenshot is always useful.
 * Please mention which direction a failure is in, e.g. Matrix -> Discord, if applicable.

We will assign each issue a tag, which will allow us to categorise the problems.

While we realise some issues are more important than others, please do not "demand"
for an issue to be fixed. Issues will be worked on in the timeframe that best fits
the needs of the team.


## PR Process

We've tried our best to keep the PR process relatively simple:

* Create a new branch based off the `develop` branch.
    * This can be done with `git checkout develop` followed by `git checkout -b featurename`.
* Create a PR on Github, making sure to give a brief discription of your changes and link to the issue it fixes, if any.
    * If your change is not complete but you would like feedback, create it as a draft.
* Ensure the linter and tests are not failing, as we will not accept code that breaks either.
    * If your tests fail and are having trouble fixing them, you may push your changes and we will help you fix them.
    * Github automatically pokes TravisCI to run both linting and tests.
* Someone from the team will review your work and decide what to do with the PR.
    * Usually we will have feedback for the PR and will submit more comments.
    * We may decide to reject it, if a feature does not fit with the project goals.

## Testing

Testing the bridge is easy enough, you just need to run `npm run build`,
`npm run lint` and `npm run test`. If all pass without errors, congratulations!

Please bear in mind that you will need to cover the whole, or a reasonable
degree of your code. You can check to see if you have with `npm run
coverage`.
