Snapshot──────────────────────────────────────────────────────────────
// Snapshot — for SuggestionEngine to read without coupling
// ─────────────────────────────────────────────────────────────────────
public static class Snapshot {
    public final int    zone1, zone2, zone3, zone4;
    public final int    entry1, entry2;
    public final int    total, occupancyPct, projected2m;
    public final double avgDelta;
    public final String prediction, alertRisk;
    public final long   timestamp;

    Snapshot(int z1, int z2, int z3, int z4, int e1, int e2,
             int total, int occ, int proj2m, double avgDelta,
             String prediction, String risk, long ts) {
        this.zone1 = z1; this.zone2 = z2; this.zone3 = z3; this.zone4 = z4;
        this.entry1 = e1; this.entry2 = e2;
        this.total = total; this.occupancyPct = occ;
        this.projected2m = proj2m; this.avgDelta = avgDelta;
        this.prediction = prediction; this.alertRisk = risk;
        this.timestamp = ts;
    }
}

/** Returns the latest computed snapshot, or null if not yet available. */
public synchronized Snapshot getSnapshot() {
    return lastSnapshot;
}