#!/bin/bash
VERSION=`python3 -c "import json; f = open('./package.json', 'r'); v = json.loads(f.read())['version']; f.close(); print(v)"`
towncrier build --version $VERSION $1
