import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class SuggestionEngine extends Thread {

    // ─────────────────────────────────────────────────────────────────────
    // Config
    // ─────────────────────────────────────────────────────────────────────
    private static final long INTERVAL_MS   = 2_000;
    private static final int  ZONE_CAPACITY = 120;          // must match DataCollector
    private static final int  TOTAL_CAP     = ZONE_CAPACITY * 4;  // 480

    private static final int  OCC_CRITICAL  = 90;   // bar entries, deploy staff
    private static final int  OCC_HIGH      = 75;   // reroute, throttle
    private static final int  OCC_MODERATE  = 55;   // PA, redistribution nudge
    private static final int  ZONE_HOT      = 80;   // per-zone congestion threshold (%)

    private static final String OUT_FILE = "suggestion.txt";

    // ─────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────
    private final DataCollector collector;

    public SuggestionEngine(DataCollector collector) {
        super("SuggestionEngine");
        this.collector = collector;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Thread loop
    // ─────────────────────────────────────────────────────────────────────
    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                evaluate();
                Thread.sleep(INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Core evaluation
    // ─────────────────────────────────────────────────────────────────────
    private void evaluate() {
        DataCollector.Snapshot snap = collector.getSnapshot();
        if (snap == null) return;

        int    occPct   = snap.occupancyPct;
        String trend    = snap.prediction;
        int    proj2m   = snap.projected2m;
        double avgDelta = snap.avgDelta;

        List<Suggestion> suggestions = new ArrayList<>();

        // ── 1. Entry barring ─────────────────────────────────────────────
        if (occPct >= OCC_CRITICAL) {
            suggestions.add(new Suggestion(
                Priority.CRITICAL,
                "BAR_ALL_ENTRIES",
                "Bar all gate entries immediately",
                "Occupancy is at " + occPct + "% — halt admissions at Gate 1 and Gate 2 "
                + "until occupancy drops below " + OCC_HIGH + "%. "
                + "Issue a hold notice at the perimeter.",
                "Gate 1, Gate 2"
            ));
        }

        // ── 2. Entry throttling ──────────────────────────────────────────
        if (occPct >= OCC_HIGH && occPct < OCC_CRITICAL) {
            suggestions.add(new Suggestion(
                Priority.HIGH,
                "THROTTLE_ENTRIES",
                "Throttle gate entry rate to 50%",
                "Occupancy is at " + occPct + "%. Slow admissions to timed batches — "
                + "one group per 30-second window at each gate. "
                + "Re-evaluate every 5 minutes.",
                "Gate 1, Gate 2"
            ));
        }

        // ── 3. Reroute gate traffic ──────────────────────────────────────
        if (snap.entry1 > snap.entry2 * 1.4 && snap.entry1 > 15) {
            suggestions.add(new Suggestion(
                Priority.HIGH,
                "REROUTE_GATE1_TO_GATE2",
                "Reroute entry traffic: Gate 1 to Gate 2",
                "Gate 1 throughput (" + snap.entry1 + ") is significantly higher than "
                + "Gate 2 (" + snap.entry2 + "). Direct incoming visitors via Gate 2 "
                + "or the north corridor to balance load.",
                "Gate 1 -> Gate 2"
            ));
        } else if (snap.entry2 > snap.entry1 * 1.4 && snap.entry2 > 15) {
            suggestions.add(new Suggestion(
                Priority.HIGH,
                "REROUTE_GATE2_TO_GATE1",
                "Reroute entry traffic: Gate 2 to Gate 1",
                "Gate 2 throughput (" + snap.entry2 + ") is significantly higher than "
                + "Gate 1 (" + snap.entry1 + "). Direct incoming visitors via Gate 1 "
                + "to balance load.",
                "Gate 2 -> Gate 1"
            ));
        }

        // ── 4. Dispatch in-person staff ───────────────────────────────────
        if (occPct >= OCC_HIGH) {
            List<String> hotZones = getHotZones(snap);
            String zoneList = hotZones.isEmpty() ? "all zones" : String.join(", ", hotZones);
            suggestions.add(new Suggestion(
                Priority.HIGH,
                "DISPATCH_STAFF",
                "Dispatch crowd management personnel",
                "Send at least 4 staff members to " + zoneList + " to manage flow, "
                + "prevent bottlenecks, and assist visitors. "
                + "Maintain radio contact with gate supervisors.",
                zoneList
            ));
        }

        // ── 5. Restrict access to congested zones ────────────────────────
        List<String> hotZones = getHotZones(snap);
        if (!hotZones.isEmpty() && occPct >= OCC_HIGH) {
            String zoneList = String.join(", ", hotZones);
            suggestions.add(new Suggestion(
                Priority.HIGH,
                "RESTRICT_HOT_ZONES",
                "Restrict movement into congested zones",
                "Zones exceeding " + ZONE_HOT + "% capacity: " + zoneList + ". "
                + "Deploy barriers at access points. Staff to monitor every 5 minutes "
                + "and lift restriction once occupancy drops below " + ZONE_HOT + "%.",
                zoneList
            ));
        }

        // ── 6. Redistribute to lowest zone ───────────────────────────────
        String lowestZone   = getLowestZone(snap);
        int    lowestPct    = getLowestZonePct(snap);
        if (lowestPct < 50 && occPct >= OCC_MODERATE) {
            suggestions.add(new Suggestion(
                Priority.MEDIUM,
                "REDISTRIBUTE_CROWD",
                "Guide visitors to " + lowestZone + " (currently " + lowestPct + "% full)",
                "Use signage and PA announcements to encourage redistribution toward "
                + lowestZone + ", which has significant remaining capacity. "
                + "Consider placing an activity or attraction there to draw crowd.",
                lowestZone
            ));
        }

        // ── 7. PA announcement ────────────────────────────────────────────
        if (occPct >= OCC_MODERATE) {
            suggestions.add(new Suggestion(
                Priority.MEDIUM,
                "PA_ANNOUNCEMENT",
                "Broadcast crowd advisory via PA system",
                "Play a recorded advisory informing visitors of congested areas "
                + "and recommending alternative zones or exits. Suggested message: "
                + "Attention visitors — some areas are currently busy. "
                + "Please move towards less crowded areas for a better experience.",
                "PA system — all zones"
            ));
        }

        // ── 8. Open overflow area ─────────────────────────────────────────
        if (occPct >= OCC_HIGH || proj2m > (int)(TOTAL_CAP * 0.80)) {
            suggestions.add(new Suggestion(
                Priority.MEDIUM,
                "OPEN_OVERFLOW",
                "Activate overflow / spillover area",
                "Current or projected occupancy warrants activating the pre-designated "
                + "overflow zone. Coordinate with logistics for seating or standing space. "
                + "Projected crowd in 2 min: " + proj2m + " / " + TOTAL_CAP + ".",
                "Overflow zone"
            ));
        }

        // ── 9. Trend-based early warning ─────────────────────────────────
        if ("Crowd Increasing".equals(trend) && occPct >= OCC_MODERATE && occPct < OCC_HIGH) {
            suggestions.add(new Suggestion(
                Priority.MEDIUM,
                "EARLY_WARNING_INCREASING",
                "Early warning — crowd growing, prepare interventions",
                "Trend is Crowd Increasing (avg delta: " + String.format("%.1f", avgDelta)
                + "/tick). Occupancy is " + occPct + "% now, projected at "
                + proj2m + " in 2 minutes. Pre-position staff and prepare gate throttle.",
                "All gates and zones"
            ));
        }

        // ── 10. Crowd decreasing — standby ───────────────────────────────
        if ("Crowd Decreasing".equals(trend) && occPct < OCC_MODERATE) {
            suggestions.add(new Suggestion(
                Priority.LOW,
                "STANDBY_DECREASING",
                "Crowd decreasing — maintain standby",
                "Trend is Crowd Decreasing. Occupancy at " + occPct + "%. "
                + "Keep 2 personnel on standby near Gate 1 for rapid deployment "
                + "in case of reversal. No active intervention needed.",
                "Gate 1 vicinity"
            ));
        }

        // ── 11. All clear ────────────────────────────────────────────────
        if (occPct < OCC_MODERATE && !"Crowd Increasing".equals(trend)) {
            suggestions.add(new Suggestion(
                Priority.LOW,
                "ALL_CLEAR",
                "No action needed — monitor only",
                "Crowd levels are within safe limits (occupancy: " + occPct + "%, "
                + "trend: " + trend + "). Continue passive monitoring. "
                + "No intervention required at this time.",
                "All zones"
            ));
        }

        write(snap, suggestions);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Zone helpers
    // ─────────────────────────────────────────────────────────────────────
    private List<String> getHotZones(DataCollector.Snapshot s) {
        List<String> hot = new ArrayList<>();
        if (pct(s.zone1) >= ZONE_HOT) hot.add("Zone 1");
        if (pct(s.zone2) >= ZONE_HOT) hot.add("Zone 2");
        if (pct(s.zone3) >= ZONE_HOT) hot.add("Zone 3");
        if (pct(s.zone4) >= ZONE_HOT) hot.add("Zone 4");
        return hot;
    }

    private String getLowestZone(DataCollector.Snapshot s) {
        int min = Math.min(Math.min(s.zone1, s.zone2), Math.min(s.zone3, s.zone4));
        if (min == s.zone1) return "Zone 1";
        if (min == s.zone2) return "Zone 2";
        if (min == s.zone3) return "Zone 3";
        return "Zone 4";
    }

    private int getLowestZonePct(DataCollector.Snapshot s) {
        return pct(Math.min(Math.min(s.zone1, s.zone2), Math.min(s.zone3, s.zone4)));
    }

    private int pct(int val) {
        return (int)(((double) val / ZONE_CAPACITY) * 100);
    }

    // ─────────────────────────────────────────────────────────────────────
    // File writer
    // ─────────────────────────────────────────────────────────────────────
    private void write(DataCollector.Snapshot snap, List<Suggestion> suggestions) {
        try (FileWriter w = new FileWriter(OUT_FILE, false)) {
            w.write("# CrowdTrack Suggestion Report\n");
            w.write("timestamp:"         + snap.timestamp    + "\n");
            w.write("total:"             + snap.total        + "\n");
            w.write("occupancy_pct:"     + snap.occupancyPct + "\n");
            w.write("prediction:"        + snap.prediction   + "\n");
            w.write("alert_risk:"        + snap.alertRisk    + "\n");
            w.write("projected_2m:"      + snap.projected2m  + "\n");
            w.write("suggestion_count:"  + suggestions.size() + "\n");
            w.write("---\n");
            int idx = 1;
            for (Suggestion s : suggestions) {
                w.write("suggestion_" + idx + "_priority:" + s.priority + "\n");
                w.write("suggestion_" + idx + "_id:"       + s.id       + "\n");
                w.write("suggestion_" + idx + "_title:"    + s.title    + "\n");
                w.write("suggestion_" + idx + "_detail:"   + s.detail   + "\n");
                w.write("suggestion_" + idx + "_target:"   + s.target   + "\n");
                idx++;
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Inner types
    // ─────────────────────────────────────────────────────────────────────
    enum Priority { CRITICAL, HIGH, MEDIUM, LOW }

    static class Suggestion {
        final Priority priority;
        final String   id;
        final String   title;
        final String   detail;
        final String   target;

        Suggestion(Priority p, String id, String title, String detail, String target) {
            this.priority = p;
            this.id       = id;
            this.title    = title;
            this.detail   = detail;
            this.target   = target;
        }
    }
}
