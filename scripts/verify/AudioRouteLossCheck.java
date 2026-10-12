import com.virtugene.app.plugins.AudioRouteLoss;

public final class AudioRouteLossCheck {
    public static void main(String[] args) {
        if (AudioRouteLoss.affectsCall(new int[]{9}, 1, 2, 3)) throw new AssertionError("unrelated removal interrupted call");
        if (!AudioRouteLoss.affectsCall(new int[]{1}, 1, 2, 3)) throw new AssertionError("input removal ignored");
        if (!AudioRouteLoss.affectsCall(new int[]{9, 2}, 1, 2, 3)) throw new AssertionError("output removal ignored");
        if (!AudioRouteLoss.affectsCall(new int[]{3}, 0, 0, 3)) throw new AssertionError("selected route removal ignored");
        if (AudioRouteLoss.affectsCall(new int[]{0}, 0, 0, 0)) throw new AssertionError("unknown route treated as removed");
        System.out.println("5 checks passed: unrelated, input, output, selected, unknown; no Android device tested");
    }
}
