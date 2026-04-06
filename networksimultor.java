public class networksimultor{
    private final DataCollector collector;

    public NetworkSimulator(DataCollector collector) {
        this.collector = collector;
    }

    public void sendData(String node, int value) {
        collector.receiveData(node, value);
    }
}
    
    


