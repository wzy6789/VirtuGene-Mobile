import com.virtugene.app.plugins.AudioCleanup;
import java.util.ArrayList;
import java.util.List;

public final class AudioCleanupCheck {
    public static void main(String[] args) {
        List<String> released = new ArrayList<>();
        int failures = AudioCleanup.run(
            () -> { throw new IllegalStateException("device pause failure"); },
            () -> released.add("track"),
            () -> { throw new SecurityException("focus permission changed"); },
            () -> released.add("recorder"),
            () -> released.add("lease"));
        if (failures != 2) throw new AssertionError("release errors not counted");
        if (!released.equals(List.of("track", "recorder", "lease"))) throw new AssertionError("one failure skipped later resources");
        if (AudioCleanup.run(() -> released.add("restart")) != 0) throw new AssertionError("healthy teardown reports failure");
        System.out.println("3 checks passed: injected failures, remaining releases, healthy teardown; no Android device tested");
    }
}
