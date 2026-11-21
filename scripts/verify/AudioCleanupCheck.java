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
        List<String> output = new ArrayList<>();
        if (AudioCleanup.output(() -> false, () -> { throw new AssertionError("uninitialized pause"); },
            () -> { throw new AssertionError("uninitialized flush"); }, () -> output.add("release")) != 0
            || !output.equals(List.of("release"))) throw new AssertionError("uninitialized track should release without invalid controls");
        output.clear();
        int outputFailures = AudioCleanup.output(() -> true,
            () -> { output.add("pause"); throw new IllegalStateException(); },
            () -> { output.add("flush"); throw new IllegalStateException(); },
            () -> { output.add("release"); throw new IllegalStateException(); });
        if (outputFailures != 3 || !output.equals(List.of("pause", "flush", "release"))) throw new AssertionError("output failure skipped release or was lost");
        output.clear();
        if (AudioCleanup.output(() -> { throw new IllegalStateException(); }, () -> {}, () -> {}, () -> output.add("release")) != 1
            || !output.equals(List.of("release"))) throw new AssertionError("state read failure skipped release");
        System.out.println("6 checks passed: injected failures, remaining releases, healthy teardown, uninitialized track, failed controls, failed state read; no Android device tested");
    }
}
