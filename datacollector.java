import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class datacollector {
    private static final long DEDUP_WINDOW_MS    = 30_000;
    private static final long STALE_ZONE_RESET_MS = 60_000;
    private static final int  ZONE_CAPACITY       = 120;
    private static final int  PRED_WINDOW         = 5;   // ttl readings to analyse

    private final Map<String, Integer> raw              = new HashMap<>();
    private final Map<String, Long>    lastSeen         = new HashMap<>();
    private final Map<String, Integer> dedupCount       = new HashMap<>();
    private final Map<String, Long>    dedupWindowStart = new HashMap<>();

    /** Rolling history of total-crowd readings. */
    private final List<Integer> totalHistory = new ArrayList<>();

    // Public API

    public synchronized void receiveData(String node, int rawValue) {
        long now    = System.currentTimeMillis();
        int deduped = applyDedupWindow(node, rawValue, now);
        raw.put(node, deduped);
        lastSeen.put(node, now);
        writeToFile(now);
    }

   
    // Deduplication
   
    private int applyDedupWindow(String node, int incoming, long now) {
        if (DEDUP_WINDOW_MS <= 0) return incoming;

        Long    windowStart = dedupWindowStart.get(node);
        Integer prevCount   = dedupCount.get(node);

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
    // prediction
    private String computePrediction() {
        if (totalHistory.size() < PRED_WINDOW) return "Stable";

        List<Integer> window = totalHistory.subList(
                totalHistory.size() - PRED_WINDOW, totalHistory.size());

        // Simple linear slope: (last - first) / (n - 1)
        int   first = window.get(0);
        int   last  = window.get(window.size() - 1);
        double slope = (double)(last - first) / (PRED_WINDOW - 1);

        if (slope > 4)  return "Crowd Increasing";
        if (slope < -4) return "Crowd Decreasing";
        return "Stable";
    }
    //avg change over prediction window
     private double computeAvgDelta() {
        if (totalHistory.size() < 2) return 0;
        List<Integer> window = totalHistory.subList(
                Math.max(0, totalHistory.size() - PRED_WINDOW), totalHistory.size());
        double sum = 0;
        for (int i = 1; i < window.size(); i++) sum += (window.get(i) - window.get(i - 1));
        return window.size() > 1 ? sum / (window.size() - 1) : 0;
    }

    // File writer
    private void writeToFile(long now) {
        int z1 = getFreshValue("Zone1", now);
        int z2 = getFreshValue("Zone2", now);
        int z3 = getFreshValue("Zone3", now);
        int z4 = getFreshValue("Zone4", now);
        int g1 = getFreshValue("Gate1", now);
        int g2 = getFreshValue("Gate2", now);

        int z1c = clamp(z1, 0, ZONE_CAPACITY);
        int z2c = clamp(z2, 0, ZONE_CAPACITY);
        int z3c = clamp(z3, 0, ZONE_CAPACITY);
        int z4c = clamp(z4, 0, ZONE_CAPACITY);

        int total         = z1c + z2c + z3c + z4c;
        int totalCapacity = ZONE_CAPACITY * 4;
        int occupancyPct  = (int)(((double) total / totalCapacity) * 100);

        // Update rolling history for prediction
        totalHistory.add(total);
        if (totalHistory.size() > PRED_WINDOW * 4) {   // keep a modest buffer
            totalHistory.remove(0);
        }

        String prediction = computePrediction();
        double avgDelta   = computeAvgDelta();
        // Simple 2-minute projection: ~60 ticks = 2 min at 2-second interval
        int projected2m   = Math.max(0, Math.min(totalCapacity,
                (int)(total + avgDelta * 60)));
        String risk       = projected2m > totalCapacity * 0.80 ? "HIGH"
                          : projected2m > totalCapacity * 0.55 ? "MEDIUM"
                          : "LOW";

        try (FileWriter w = new FileWriter("data.txt", false)) {
            w.write("zone1:"          + z1c         + "\n");
            w.write("zone2:"          + z2c         + "\n");
            w.write("zone3:"          + z3c         + "\n");
            w.write("zone4:"          + z4c         + "\n");
            w.write("entry1:"         + g1          + "\n");
            w.write("entry2:"         + g2          + "\n");
            w.write("total:"          + total       + "\n");
            w.write("occupancy_pct:"  + occupancyPct + "\n");
            w.write("capacity:"       + totalCapacity + "\n");
            w.write("timestamp:"      + now         + "\n");
            // Prediction fields
            w.write("prediction:"     + prediction  + "\n");
            w.write("avg_delta:"      + String.format("%.2f", avgDelta) + "\n");
            w.write("projected_2m:"   + projected2m + "\n");
            w.write("alert_risk:"     + risk        + "\n");
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
    // Helpers
    // ─────────────────────────────────────────────────────────────────────
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
}


