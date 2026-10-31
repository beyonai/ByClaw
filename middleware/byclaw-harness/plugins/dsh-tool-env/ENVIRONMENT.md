# Tool process environment boundary

The runtime host may hold shared infrastructure credentials. A tool sandbox is a
user execution boundary, so SSH process requests must not inherit the host's Redis,
cloud provider, tracing, platform bridge, web management, JEV, or Typesafe credentials.
`scrubEnvironment` applies to the merged launch and caller environment immediately
before SSH dispatch. It preserves the logged-in user's `BEYOND_TOKEN`, identity,
locale, and ordinary business settings for authorized ByClaw CLI operations.

The tool sandbox service specification must also remain free of shared infrastructure
credentials. Adding another host provider requires extending the central protected
environment policy and its regression test before forwarding that provider's settings.
This policy does not grant file access: each tool sandbox still mounts only its
own user's AgenticFS access point, and file API requests retain user authorization.
