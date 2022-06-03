#!/bin/bash
pip3 install towncrier==19.2.0
python3 -m towncrier.check --compare-with=origin/develop