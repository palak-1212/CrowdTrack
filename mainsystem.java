import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Paths;

public class MainSystem {
    private static final int    PORT      = 8080;
    private static final String DATA_FILE = "data.txt";
    private static final String DASH_FILE = "dashboard-1-updated-1.html";

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/data.txt",      new FileHandler(DATA_FILE, "text/plain"));
        server.createContext("/dashboard.html", new FileHandler(DASH_FILE, "text/html"));
        server.createContext("/",              new FileHandler(DASH_FILE, "text/html"));
        server.setExecutor(null);
        server.start();
        server.createContext("/suggestion.txt", new FileHandler("suggestion.txt", "text/plain"));

        System.out.println("============================================");
        System.out.println("CrowdTrack running (v2.5 — with Prediction)");
        System.out.println("Dashboard : http://localhost:" + PORT);
        System.out.println("Data feed : http://localhost:" + PORT + "/data.txt");
        System.out.println("============================================");

        DataCollector collector = new DataCollector();
        SuggestionEngine suggEngine = new SuggestionEngine(collector);
        suggEngine.setDaemon(true);
        suggEngine.start();
        NetworkSimulator network = new NetworkSimulator(collector);

        String[] nodeNames = {"Zone1", "Zone2", "Zone3", "Zone4", "Gate1", "Gate2"};
        for (String name : nodeNames) {
            FakeNode node = new FakeNode(name, network);
            node.setDaemon(true);
            node.start();
        }

        System.out.println("6 sensor nodes started (2 s interval)");
        System.out.println("Prediction engine: 5-point rolling window");
        System.out.println("  → Crowd Increasing  (slope > +4/tick)");
        System.out.println("  → Crowd Decreasing  (slope < -4/tick)");
        System.out.println("  → Stable            (otherwise)");
        System.out.println("============================================");

        // Periodic console prediction log (every 10 seconds)
        Thread predLogger = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    Thread.sleep(10_000);
                    logPrediction();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        });
        predLogger.setDaemon(true);
        predLogger.start();

        Thread.currentThread().join();
    }

    /**
     * Reads the current data.txt and prints the prediction line to stdout.
     * This gives operators a console-level view of the prediction without
     * needing to open the dashboard.
     */
    private static void logPrediction() {
        File f = new File(DATA_FILE);
        if (!f.exists()) return;
        try {
            String content = new String(Files.readAllBytes(Paths.get(DATA_FILE)));
            String prediction = "—";
            String total      = "—";
            String risk       = "—";
            String proj2m     = "—";
            for (String line : content.split("\n")) {
                String trimmed = line.trim();
                if (trimmed.startsWith("prediction:"))   prediction = trimmed.substring(11).trim();
                if (trimmed.startsWith("total:"))        total      = trimmed.substring(6).trim();
                if (trimmed.startsWith("alert_risk:"))   risk       = trimmed.substring(11).trim();
                if (trimmed.startsWith("projected_2m:")) proj2m     = trimmed.substring(13).trim();
            }
            System.out.printf("[PREDICT] Total: %-4s | %-20s | Risk: %-6s | Proj(2m): %s%n",
                    total, prediction, risk, proj2m);
        } catch (IOException e) {
            // Non-fatal — skip this log cycle
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // HTTP file handler
    // ─────────────────────────────────────────────────────────────────────
    static class FileHandler implements HttpHandler {
        private final String path;
        private final String mime;

        FileHandler(String path, String mime) {
            this.path = path;
            this.mime = mime;
        }

        @Override
        public void handle(HttpExchange ex) throws IOException {
            ex.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            ex.getResponseHeaders().add("Cache-Control", "no-store, no-cache");
            ex.getResponseHeaders().add("Content-Type", mime + "; charset=utf-8");

            File f = new File(path);
            if (!f.exists()) {
                ex.sendResponseHeaders(200, 0);
                ex.getResponseBody().close();
                return;
            }

            byte[] bytes = Files.readAllBytes(Paths.get(path));
            ex.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(bytes);
            }
        }
    }
    
}
