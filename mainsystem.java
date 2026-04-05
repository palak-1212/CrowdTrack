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

        System.out.println("============================================");
        System.out.println("CrowdTrack running (v2.5 — with Prediction)");
        System.out.println("Dashboard : http://localhost:" + PORT);
        System.out.println("Data feed : http://localhost:" + PORT + "/data.txt");
        System.out.println("============================================");

        DataCollector collector = new DataCollector();
        NetworkSimulator network = new NetworkSimulator(collector);

        String[] nodeNames = {"Zone1", "Zone2", "Zone3", "Zone4", "Gate1", "Gate2"};
        for (String name : nodeNames) {
            FakeNode node = new FakeNode(name, network);
            node.setDaemon(true);
            node.start();
        }