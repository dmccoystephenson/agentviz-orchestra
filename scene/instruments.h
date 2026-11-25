// instruments.h: what a figure plays (one instrument family per action),
// chairs, music stands, drifting notes and the per-call note.
#pragma once

#include "draw_util.h"

namespace orchestra {

// Where an instrument's sound comes from (notes rise from here).
struct Sound {
    float x, y, z;
};

// A player: chest at (cx, cy, cz), facing (dx, dz), right hand (px, pz).
struct Player {
    float cx, cy, cz, dx, dz, px, pz, floorY, phase;
};

// A chair: seat plus a back on the side away from (dx, dz).
inline void chair(Host& h, float x, float y, float z, float dx, float dz, Rgb c) {
    box(h, x, y + 0.45f, z, 0.46f, 0.06f, 0.46f, c);
    for (int lx = -1; lx <= 1; lx += 2)
        for (int lz = -1; lz <= 1; lz += 2) box(h, x + lx * 0.19f, y + 0.21f, z + lz * 0.19f, 0.05f, 0.42f, 0.05f, scale(c, 0.6f));
    const bool alongX = std::fabs(dx) > std::fabs(dz);
    box(h, x - dx * 0.22f, y + 0.75f, z - dz * 0.22f, alongX ? 0.05f : 0.46f, 0.55f, alongX ? 0.46f : 0.05f, c);
}

// Soft music notes drifting up from (x, y, z).
inline void notes(Host& h, Sound s, Rgb c, float t, float seed, int n, float strength) {
    for (int k = 0; k < n; ++k) {
        const float life = std::fmod(t * 0.5f + seed * 7.0f + k / static_cast<float>(n), 1.0f);
        const float sway = std::sin(life * 6.0f + seed * 20.0f + k) * 0.25f;
        const float a = (1.0f - life) * std::min(life * 5.0f, 1.0f) * strength;
        h.point(s.x + sway, s.y + life * 1.6f, s.z + std::cos(life * 5.0f + k) * 0.15f, 9.0f, 0.14f, c, a);
    }
}

// One new tool call: a bright note head and stem pops up and fades, with a
// flash of the family colour (pulse is 1 at the call, easing to 0).
inline void callNote(Host& h, Sound s, Rgb c, float pulseK) {
    if (pulseK <= 0.01f) return;
    const float rise = (1.0f - pulseK) * 1.2f, y = s.y + 0.6f + rise, a = pulseK;
    const Rgb bright = mix(c, kWhite, 0.35f);
    ball(h, s.x, y, s.z, 0.18f + 0.16f * a, 0.14f + 0.12f * a, 0.18f + 0.16f * a, bright);
    wide(h, s.x + 0.16f, y, s.z, s.x + 0.16f, y + 0.62f, s.z, bright, 4.0f, 0.045f, a);
    wide(h, s.x + 0.16f, y + 0.62f, s.z, s.x + 0.4f, y + 0.44f, s.z, bright, 4.0f, 0.045f, a);
    h.point(s.x, y, s.z, 40.0f + 40.0f * a, 0.8f, c, 0.7f * a);
    if (a > 0.3f) h.light(s.x, y, s.z, 3.5f, c, 2.0f * a, 6);
}

inline Sound strings(Host& h, const Player& p, float t) {  // a cello between the knees, bowing
    const float bx = p.cx + p.dx * 0.32f, bz = p.cz + p.dz * 0.32f, by = p.cy - 0.12f;
    ball(h, bx, by, bz, 0.30f, 0.46f, 0.30f, {0.50f, 0.22f, 0.08f});
    ball(h, bx, by + 0.18f, bz, 0.24f, 0.26f, 0.24f, {0.55f, 0.25f, 0.09f});
    wide(h, bx, by + 0.15f, bz, bx, by + 0.85f, bz, {0.12f, 0.07f, 0.04f}, 3.0f, 0.04f);
    const float s = std::sin(t * 5.0f + p.phase) * 0.28f;
    const float ex = bx + p.dx * 0.12f, ez = bz + p.dz * 0.12f, ey = by + 0.05f;
    wide(h, ex + p.px * (s - 0.35f), ey + 0.06f, ez + p.pz * (s - 0.35f), ex + p.px * (s + 0.35f), ey - 0.04f,
         ez + p.pz * (s + 0.35f), {0.92f, 0.85f, 0.65f}, 2.5f, 0.02f);
    return {bx, by + 0.4f, bz};
}

inline Sound percussion(Host& h, const Player& p, float t) {  // a drum, sticks hitting
    const float bx = p.cx + p.dx * 0.45f, bz = p.cz + p.dz * 0.45f, top = p.cy - 0.12f;
    disc(h, bx, top - 0.14f, bz, 0.55f, 0.14f, {0.75f, 0.20f, 0.12f});
    disc(h, bx, top + 0.005f, bz, 0.52f, 0.01f, {0.92f, 0.88f, 0.78f});
    for (int side = -1; side <= 1; side += 2) {
        const float beat = std::sin(t * 7.0f + p.phase + (side > 0 ? kPi : 0.0f));
        const float lift = std::max(beat, 0.0f) * 0.32f;
        const float hx = p.cx + p.dx * 0.2f + p.px * side * 0.2f, hz = p.cz + p.dz * 0.2f + p.pz * side * 0.2f;
        const float tx = bx + p.px * side * 0.12f, tz = bz + p.pz * side * 0.12f;
        wide(h, hx, p.cy + 0.02f, hz, tx, top + 0.03f + lift, tz, {0.85f, 0.75f, 0.55f}, 2.5f, 0.025f);
        if (beat < -0.8f) h.point(tx, top + 0.06f, tz, 22.0f, 0.3f, {1.0f, 0.75f, 0.35f}, 0.8f);
    }
    return {bx, top, bz};
}

inline Sound woodwind(Host& h, const Player& p, float t) {  // a clarinet from the lips, angled down
    const float mx = p.cx + p.dx * 0.16f, mz = p.cz + p.dz * 0.16f, my = p.cy + 0.38f;
    const float sway = std::sin(t * 1.6f + p.phase) * 0.06f;
    const float ex = p.cx + p.dx * 0.55f + p.px * sway, ez = p.cz + p.dz * 0.55f + p.pz * sway, ey = p.cy - 0.15f;
    wide(h, mx, my, mz, ex, ey, ez, {0.08f, 0.10f, 0.08f}, 4.0f, 0.05f);
    ball(h, ex, ey, ez, 0.12f, 0.08f, 0.12f, {0.15f, 0.45f, 0.25f});
    for (int k = 1; k < 4; ++k) {
        const float f = k / 4.0f;
        h.point(mx + (ex - mx) * f, my + (ey - my) * f, mz + (ez - mz) * f, 4.0f, 0.03f, {0.85f, 0.88f, 0.9f}, 0.9f, 0);
    }
    return {ex, ey, ez};
}

inline Sound brass(Host& h, const Player& p, float t) {  // a horn raised, its bell catching the light
    const float lift = 0.1f + 0.05f * std::sin(t * 2.2f + p.phase);
    const float mx = p.cx + p.dx * 0.16f, mz = p.cz + p.dz * 0.16f, my = p.cy + 0.38f;
    const float ex = p.cx + p.dx * 0.85f, ez = p.cz + p.dz * 0.85f, ey = my + lift;
    wide(h, mx, my, mz, ex, ey, ez, {0.85f, 0.65f, 0.18f}, 4.5f, 0.05f);
    ball(h, ex, ey, ez, 0.24f, 0.24f, 0.24f, {0.95f, 0.72f, 0.20f});
    h.add(STRATA_PRIMITIVE_CYLINDER, (mx + ex) * 0.5f, my - 0.08f, (mz + ez) * 0.5f, 0.12f, 0.06f, 0.12f, {0.8f, 0.6f, 0.15f});
    return {ex, ey, ez};
}

inline Sound smallBaton(Host& h, const Player& p, float t) {
    const float s = std::sin(t * 3.0f + p.phase);
    const float hx = p.cx + p.dx * 0.3f + p.px * s * 0.2f, hz = p.cz + p.dz * 0.3f + p.pz * s * 0.2f;
    const float hy = p.cy + 0.25f + 0.12f * std::fabs(std::cos(t * 3.0f + p.phase));
    wide(h, hx, hy, hz, hx + p.dx * 0.25f + p.px * s * 0.15f, hy + 0.35f, hz + p.dz * 0.25f + p.pz * s * 0.15f, kWhite,
         2.5f, 0.015f);
    return {hx, hy + 0.35f, hz};
}

inline Sound restingOnLap(Host& h, const Player& p) {  // think: holding still
    box(h, p.cx + p.dx * 0.2f, p.cy - 0.2f, p.cz + p.dz * 0.2f, 0.3f, 0.06f, 0.3f, scale(family(Action::Think), 0.6f));
    return {p.cx, p.cy + 0.65f, p.cz};
}

inline Sound triangle(Host& h, const Player& p, float t) {  // other tools: a triangle and its beater
    const float bx = p.cx + p.dx * 0.4f, bz = p.cz + p.dz * 0.4f, by = p.cy + 0.1f, r = 0.17f;
    const Rgb steel{0.75f, 0.85f, 0.95f};
    const float ax = bx - p.px * r, az = bz - p.pz * r, cx = bx + p.px * r, cz = bz + p.pz * r;
    wide(h, bx, by + r * 1.6f, bz, ax, by, az, steel, 2.5f, 0.02f);
    wide(h, ax, by, az, cx, by, cz, steel, 2.5f, 0.02f);
    wide(h, cx, by, cz, bx, by + r * 1.6f, bz, steel, 2.5f, 0.02f);
    const float hit = std::sin(t * 4.0f + p.phase);
    wide(h, bx + p.px * 0.25f, by + 0.15f + hit * 0.08f, bz + p.pz * 0.25f, bx + p.px * 0.05f, by + 0.12f,
         bz + p.pz * 0.05f, {0.6f, 0.6f, 0.65f}, 2.0f, 0.015f);
    if (hit > 0.9f) h.point(bx, by + 0.2f, bz, 16.0f, 0.2f, steel, 0.7f);
    return {bx, by + 0.2f, bz};
}

// The family's instrument, played when up >= 0.5, otherwise resting on the
// floor beside the chair. Returns where the sound comes from.
inline Sound instrument(Host& h, Action action, const Player& p, float up, float t) {
    if (up < 0.5f || action == Action::None) {
        const Rgb c = action == Action::None ? Rgb{0.30f, 0.20f, 0.12f} : scale(family(action), 0.7f);
        box(h, p.cx + p.px * 0.45f, p.floorY + 0.07f, p.cz + p.pz * 0.45f, 0.22f, 0.12f, 0.22f, c);
        return {p.cx + p.dx * 0.4f, p.cy + 0.4f, p.cz + p.dz * 0.4f};
    }
    switch (action) {
        case Action::Edit: return strings(h, p, t);
        case Action::Run: return percussion(h, p, t);
        case Action::Read: return woodwind(h, p, t);
        case Action::Web: return brass(h, p, t);
        case Action::Delegate: return smallBaton(h, p, t);
        case Action::Think: return restingOnLap(h, p);
        default: return triangle(h, p, t);
    }
}

// A music stand facing (dx, dz): a pole and a plate in the family colour, lit
// while playing, and a pile of score pages that grows with the tool count.
inline void musicStand(Host& h, float x, float y, float z, float dx, float dz, Action action, bool lit, int toolCount,
                       float pulseK) {
    disc(h, x, y + 0.45f, z, 0.04f, 0.45f, {0.12f, 0.12f, 0.13f});
    const bool alongX = std::fabs(dx) > std::fabs(dz);
    const Rgb fam = family(action);
    const Rgb plate = mix(lit ? fam : scale(fam, 0.35f), kWhite, 0.5f * pulseK);
    box(h, x, y + 0.98f, z, alongX ? 0.04f : 0.44f, 0.3f, alongX ? 0.44f : 0.04f, plate);
    const float pile = std::min(0.16f, 0.018f * std::log2(1.0f + static_cast<float>(toolCount)));
    if (pile > 0.0f)
        box(h, x - dx * 0.04f, y + 0.84f + pile * 0.5f, z - dz * 0.04f, alongX ? 0.05f : 0.36f, pile,
            alongX ? 0.36f : 0.05f, {0.93f, 0.9f, 0.82f});
    if (lit) h.point(x, y + 1.02f, z, 10.0f, 0.25f, fam, 0.35f);
}

// Stalled: a red wrong note above (x, y, z) and a red flash.
inline void wrongNote(Host& h, float x, float y, float z, float t, float size = 1.0f) {
    const float flash = stallFlash(t);
    h.point(x, y + 0.05f, z, (30.0f + 30.0f * flash) * size, 0.6f * size, kRed, 0.2f + 0.7f * flash);
    const float ny = y + flash * 0.2f * size;
    ball(h, x + 0.25f * size, ny, z, 0.16f * size, 0.13f * size, 0.16f * size, {0.9f, 0.08f, 0.06f});
    wide(h, x + 0.32f * size, ny, z, x + 0.32f * size, ny + 0.4f * size, z, {0.9f, 0.08f, 0.06f}, 3.0f, 0.03f);
    if (flash > 0.2f) h.light(x, y + 0.15f, z, 5.0f * size, {1.0f, 0.1f, 0.05f}, 3.0f * flash, 7);
}

}  // namespace orchestra
