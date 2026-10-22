#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
# AWS-issued SSH credentials expire. Refresh them through Lightsail before reuse.
exec ssh -N -L 127.0.0.1:8080:127.0.0.1:8080 \
  -i data/aws-staging/ssh-key \
  -o UserKnownHostsFile=data/aws-staging/known_hosts \
  -o StrictHostKeyChecking=yes -o BatchMode=yes \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 ubuntu@3.27.235.8
