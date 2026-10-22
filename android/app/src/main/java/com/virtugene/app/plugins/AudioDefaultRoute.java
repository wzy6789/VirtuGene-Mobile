package com.virtugene.app.plugins;

/** Per-call intent only; neither device availability nor an accepted request proves routed audio. */
final class AudioDefaultRoute {
    static final int WAIT = Integer.MIN_VALUE;
    private boolean explicit, privateRequired;
    private int preferredId, preferredType;

    static boolean privateType(int type) {
        return type == 3 || type == 4 || type == 7 || type == 11 || type == 22 || type == 23 || type == 26;
    }
    static boolean connectedHeadsetType(int type) { return privateType(type) || type == 8; }
    void reset() { explicit = privateRequired = false; preferredId = preferredType = 0; }
    void requirePrivate() { privateRequired = true; }
    void remember(int id, int type) {
        explicit = true; preferredId = id; preferredType = type; privateRequired = privateType(type);
    }
    int choose(int currentId, int currentType, int[] ids, int[] types, boolean headsetConnected) {
        if (ids.length != types.length) throw new IllegalArgumentException("route-shape");
        if (explicit) {
            for (int i = 0; i < ids.length; i++) if (ids[i] == preferredId && types[i] == preferredType) return ids[i];
            return WAIT;
        }
        if (privateType(currentType)) {
            for (int i = 0; i < ids.length; i++) if (ids[i] == currentId && types[i] == currentType) { privateRequired = true; return ids[i]; }
        }
        int selected = WAIT, rank = Integer.MAX_VALUE;
        for (int i = 0; i < ids.length; i++) {
            int candidate = types[i] == 3 || types[i] == 4 || types[i] == 11 || types[i] == 22 ? 1
                : types[i] == 7 || types[i] == 26 ? 2 : types[i] == 23 ? 3 : Integer.MAX_VALUE;
            if (candidate < rank) { selected = ids[i]; rank = candidate; }
        }
        if (selected != WAIT) { privateRequired = true; return selected; }
        if (privateRequired || headsetConnected) return WAIT;
        for (int i = 0; i < ids.length; i++) if (ids[i] == currentId && (types[i] == 1 || types[i] == 2)) return ids[i];
        for (int type : new int[] { 1, 2 }) for (int i = 0; i < ids.length; i++) if (types[i] == type) return ids[i];
        return WAIT;
    }
}
