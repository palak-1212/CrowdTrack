import java.io.FileWriter;
import java.io.IOException;
import java.util.*;

public class DataCollector {

    private volatile Snapshot lastSnapshot = null;

    private static final long DEDUP_WINDOW_MS     = 30_000;
    private static final long STALE_ZONE_RESET_MS = 60_000;
    private static final int  ZONE_CAPACITY       = 120;
    private static final int  PRED_WINDOW         = 5;

    private final Map<String, Integer> raw              = new HashMap<>();
    private final Map<String, Long>    lastSeen         = new HashMap<>();
    private final Map<String, Integer> dedupCount       = new HashMap<>();
    private final Map<String, Long>    dedupWindowStart = new HashMap<>();

    private final List<Integer> totalHistory = new ArrayList<>();

    // ─────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────
    public synchronized void receiveData(String node, int rawValue) {
        long now = System.currentTimeMillis();

        int deduped = applyDedupWindow(node, rawValue, now);
        raw.put(node, deduped);
        lastSeen.put(node, now);

        writeToFile(now);
    }

    // ─────────────────────────────────────────────
    // Deduplication
    // ─────────────────────────────────────────────
    private int applyDedupWindow(String node, int incoming, long now) {
        if (DEDUP_WINDOW_MS <= 0) return incoming;

        Long windowStart = dedupWindowStart.get(node);
        Integer prevCount = dedupCount.get(node);

        if (windowStart == null || prevCount == null) {
            dedupWindowStart.put(node, now);
            dedupCount.put(node, incoming);
            return incoming;
        }

        long elapsed = now - windowStart;

        if (elapsed >= DEDUP_WINDOW_MS) {
            dedupWindowStart.put(node, now);
            dedupCount.put(node, incoming);
            return incoming;
        }

        int delta = incoming - prevCount;

        if (delta > 2) {
            dedupCount.put(node, incoming);
            return incoming;
        }

        if (delta >= -2) {
            return prevCount;
        }

        dedupCount.put(node, incoming);
        return incoming;
    }

    // ─────────────────────────────────────────────
    // Prediction
    // ─────────────────────────────────────────────
    private String computePrediction() {
        if (totalHistory.size() < PRED_WINDOW) return "Stable";

        List<Integer> window = totalHistory.subList(
                totalHistory.size() - PRED_WINDOW,
                totalHistory.size()
        );

        int first = window.get(0);
        int last  = window.get(window.size() - 1);

        double slope = (double) (last - first) / (PRED_WINDOW - 1);

        if (slope > 4)  return "Crowd Increasing";
        if (slope < -4) return "Crowd Decreasing";
        return "Stable";
    }

    private double computeAvgDelta() {
        if (totalHistory.size() < 2) return 0;

        List<Integer> window = totalHistory.subList(
                Math.max(0, totalHistory.size() - PRED_WINDOW),
                totalHistory.size()
        );

        double sum = 0;
        for (int i = 1; i < window.size(); i++) {
            sum += (window.get(i) - window.get(i - 1));
        }

        return window.size() > 1 ? sum / (window.size() - 1) : 0;
    }

    // ─────────────────────────────────────────────
    // Core processing + file writing
    // ─────────────────────────────────────────────
    private void writeToFile(long now) {

        int z1 = clamp(getFreshValue("Zone1", now), 0, ZONE_CAPACITY);
        int z2 = clamp(getFreshValue("Zone2", now), 0, ZONE_CAPACITY);
        int z3 = clamp(getFreshValue("Zone3", now), 0, ZONE_CAPACITY);
        int z4 = clamp(getFreshValue("Zone4", now), 0, ZONE_CAPACITY);

        int g1 = getFreshValue("Gate1", now);
        int g2 = getFreshValue("Gate2", now);

        int total         = z1 + z2 + z3 + z4;
        int totalCapacity = ZONE_CAPACITY * 4;
        int occupancyPct  = (int) (((double) total / totalCapacity) * 100);

        // Maintain history
        totalHistory.add(total);
        if (totalHistory.size() > PRED_WINDOW * 4) {
            totalHistory.remove(0);
        }

        // Prediction
        String prediction = computePrediction();
        double avgDelta   = computeAvgDelta();

        int projected2m = Math.max(0, Math.min(totalCapacity,
                (int) (total + avgDelta * 60)));

        String risk = projected2m > totalCapacity * 0.80 ? "HIGH"
                    : projected2m > totalCapacity * 0.55 ? "MEDIUM"
                    : "LOW";

        // ✅ Always update snapshot
        lastSnapshot = new Snapshot(
                z1, z2, z3, z4,
                g1, g2,
                total, occupancyPct,
                projected2m, avgDelta,
                prediction, risk, now
        );

        // Write file
        try (FileWriter w = new FileWriter("data.txt", false)) {
            w.write("zone1:" + z1 + "\n");
            w.write("zone2:" + z2 + "\n");
            w.write("zone3:" + z3 + "\n");
            w.write("zone4:" + z4 + "\n");
            w.write("entry1:" + g1 + "\n");
            w.write("entry2:" + g2 + "\n");
            w.write("total:" + total + "\n");
            w.write("occupancy_pct:" + occupancyPct + "\n");
            w.write("capacity:" + totalCapacity + "\n");
            w.write("timestamp:" + now + "\n");

            w.write("prediction:" + prediction + "\n");
            w.write("avg_delta:" + String.format("%.2f", avgDelta) + "\n");
            w.write("projected_2m:" + projected2m + "\n");
            w.write("alert_risk:" + risk + "\n");

        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────
    private int getFreshValue(String node, long now) {
        Long ts = lastSeen.get(node);

        if (ts == null) return 0;

        if ((now - ts) > STALE_ZONE_RESET_MS) {
            raw.remove(node);
            lastSeen.remove(node);
            dedupCount.remove(node);
            dedupWindowStart.remove(node);
            return 0;
        }

        return raw.getOrDefault(node, 0);
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    // ─────────────────────────────────────────────
    // Snapshot
    // ─────────────────────────────────────────────
    public static class Snapshot {
        public final int zone1, zone2, zone3, zone4;
        public final int entry1, entry2;
        public final int total, occupancyPct, projected2m;
        public final double avgDelta;
        public final String prediction, alertRisk;
        public final long timestamp;

        Snapshot(int z1, int z2, int z3, int z4,
                 int e1, int e2,
                 int total, int occ,
                 int proj2m, double avgDelta,
                 String prediction, String risk,
                 long ts) {

            this.zone1 = z1;
            this.zone2 = z2;
            this.zone3 = z3;
            this.zone4 = z4;

            this.entry1 = e1;
            this.entry2 = e2;

            this.total = total;
            this.occupancyPct = occ;
            this.projected2m = proj2m;
            this.avgDelta = avgDelta;

            this.prediction = prediction;
            this.alertRisk = risk;
            this.timestamp = ts;
        }
    }

    public synchronized Snapshot getSnapshot() {
        return lastSnapshot;
    }
}