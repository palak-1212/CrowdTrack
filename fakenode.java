import java.util.Random;

public class FakeNode extends Thread {
    private final String nodeName;
    private final NetworkSimulator network;
    private final Random rand = new Random();
    private int currentValue;

    public FakeNode(String name, NetworkSimulator network){
        this.nodeName = name;
        this.network = network;
        if (nodeName.startsWith("Zone")) {
            currentValue = 30 + rand.nextInt(50);
        } else {
            currentValue = 10 + rand.nextInt(20);
        }
    }

    @Override
    public void run() {
        while (true) {
            int maxVal = nodeName.startsWith("Zone") ? 120 : 40;
            int drift = rand.nextInt(11) - 5;
            currentValue = Math.max(0, Math.min(maxVal, currentValue + drift));

            int reportValue = currentValue;
            if (rand.nextInt(10) < 2) {
                reportValue += rand.nextBoolean() ? 1 : -1;
                reportValue = Math.max(0, Math.min(maxVal, reportValue));
            }

            System.out.println(nodeName + " sending: " + reportValue);
            network.sendData(nodeName, reportValue);

            try {
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }
}

