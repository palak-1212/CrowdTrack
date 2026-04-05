import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class DataCollector {
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
     private double computeAvgDelta() {
        if (totalHistory.size() < 2) return 0;
        List<Integer> window = totalHistory.subList(
                Math.max(0, totalHistory.size() - PRED_WINDOW), totalHistory.size());
        double sum = 0;
        for (int i = 1; i < window.size(); i++) sum += (window.get(i) - window.get(i - 1));
        return window.size() > 1 ? sum / (window.size() - 1) : 0;
    }
    
}
