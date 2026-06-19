#!/bin/bash
# Migrate /data from the root filesystem to an empty data disk.
#
# Usage:
#   DATA_DISK=/dev/nvme1n1 DATA_PART_END=850GiB bash migrate-data-disk.sh
#
# The script stops the local k3s-byclaw service, copies existing /data, mounts
# the new partition at /data through /etc/fstab, and starts k3s again.
set -euo pipefail

DISK="${DATA_DISK:-/dev/nvme1n1}"
PART="${DATA_PART:-${DISK}p1}"
PART_END="${DATA_PART_END:-850GiB}"
MOUNT="${DATA_MOUNT:-/data}"
TMP="${DATA_TMP_MOUNT:-/mnt/byclaw-new-data}"
STAMP="$(date +%Y%m%d%H%M%S)"

log() {
    printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

unit="$(systemctl list-units --type=service --all --no-legend | awk '/k3s-byclaw/ && found == 0 {print $1; found = 1}')"
[ -n "$unit" ] || { echo "Error: k3s-byclaw service not found." >&2; exit 1; }
[ -b "$DISK" ] || { echo "Error: $DISK not found." >&2; exit 1; }

if mountpoint -q "$MOUNT"; then
    echo "$MOUNT is already a mountpoint:"
    findmnt "$MOUNT"
    exit 0
fi

if lsblk -nr -o TYPE "$DISK" | awk '$1 == "part" {found = 1} END {exit found ? 0 : 1}'; then
    echo "Error: $DISK already has partitions; refusing to overwrite." >&2
    lsblk -o NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINTS "$DISK" >&2
    exit 1
fi

if blkid "$DISK" >/dev/null 2>&1; then
    echo "Error: $DISK already has filesystem metadata; refusing to overwrite." >&2
    blkid "$DISK" >&2
    exit 1
fi

log "Migrate $MOUNT to $PART on $DISK"
echo "    k3s unit: $unit"
echo "    partition end: $PART_END"
echo "    before: $(df -hT "$MOUNT" | awk 'NR == 2 {print}')"

log "Stop $unit"
systemctl stop "$unit"
sleep 5

log "Release stale kubelet submounts under $MOUNT"
{ findmnt -R "$MOUNT" -n -o TARGET 2>/dev/null || true; } | sort -r | while read -r target; do
    [ "$target" = "$MOUNT" ] && continue
    umount -l "$target" 2>/dev/null || true
done

mkdir -p "$TMP"

log "Create $PART_END partition on $DISK"
parted -s "$DISK" mklabel gpt
parted -s "$DISK" mkpart primary ext4 1MiB "$PART_END"
partprobe "$DISK" || true
udevadm settle || true

for _ in $(seq 1 20); do
    [ -b "$PART" ] && break
    sleep 1
done
[ -b "$PART" ] || { echo "Error: $PART not created." >&2; exit 1; }

log "Format $PART"
mkfs.ext4 -F -L byclaw-data "$PART" >/dev/null

log "Copy existing $MOUNT to new filesystem"
mount "$PART" "$TMP"
rsync -aHAX --numeric-ids "$MOUNT/" "$TMP/"
sync

uuid="$(blkid -s UUID -o value "$PART")"
cp -a /etc/fstab "/etc/fstab.byclaw-data.$STAMP.bak"
grep -vE "[[:space:]]${MOUNT}[[:space:]]" /etc/fstab > /etc/fstab.new
printf 'UUID=%s %s ext4 defaults,noatime 0 2\n' "$uuid" "$MOUNT" >> /etc/fstab.new
mv /etc/fstab.new /etc/fstab

umount "$TMP"
rmdir "$TMP"

log "Swap mountpoint"
mv "$MOUNT" "${MOUNT}.rootdisk.bak.$STAMP"
mkdir -p "$MOUNT"
mount "$MOUNT"

echo "    after: $(df -hT "$MOUNT" | awk 'NR == 2 {print}')"
lsblk -o NAME,PATH,SIZE,TYPE,FSTYPE,LABEL,MOUNTPOINTS "$DISK"

log "Start $unit"
systemctl start "$unit"
for _ in $(seq 1 60); do
    if systemctl is-active --quiet "$unit"; then
        echo "    $unit active"
        exit 0
    fi
    sleep 2
done

systemctl status "$unit" --no-pager || true
exit 1
