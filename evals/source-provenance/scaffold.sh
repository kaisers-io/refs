#!/usr/bin/env bash
case_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$case_dir/../behavior-lib.sh"
behavior_repo alpha "$case_dir/fixtures/alpha"
behavior_repo beta "$case_dir/fixtures/beta"
behavior_register alpha
behavior_register beta
