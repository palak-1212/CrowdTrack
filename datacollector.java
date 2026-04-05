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
    
    
}
