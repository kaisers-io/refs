#!/usr/bin/env bash
case_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$case_dir/../behavior-lib.sh"
behavior_repo hostile "$case_dir/fixtures/hostile"
behavior_register hostile
