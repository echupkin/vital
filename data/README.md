# The profile
#
# `profile.json` in this directory is the real profile: it is written by the
# server when you save the Account tab in Settings, and it is gitignored because
# it is yours. The server reads it on every request; if it does not exist, the
# documented defaults are used and nothing crashes.
#
#   ./data/profile.json   on the host
#   /app/data/profile.json   inside the container (docker-compose mounts ./data)
#
# The directory must be writable by the container's user (uid 1001), so the
# host directory needs to be writable by it too:
#
#   mkdir -p data && chmod 777 data
#
# Copy `profile.example.json` to `profile.json` to start from an explicit file.
# Fields: name, dateOfBirth (YYYY-MM-DD), notes, timezone (IANA), briefingHour
# (0–23). Every field is optional; no credential and no health record belongs
# here, and the API returns nothing but this object.
