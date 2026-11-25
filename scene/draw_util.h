// draw_util.h: colours, shapes and the stage geometry shared by the
// orchestra's drawing (hall.h, instruments.h, conductor.h, musician.h).
#pragma once

#include <algorithm>
#include <cmath>

#include "strata_kit.h"
#include "../vendor/agentviz-kit/scene/agentviz.h"

namespace orchestra {

using strata_kit::Host;
using strata_kit::Rgb;
using agentviz::Action;
using agentviz::State;

constexpr float kPi = 3.14159265f;

const Rgb kWhite{1.0f, 1.0f, 1.0f};
const Rgb kGold{1.0f, 0.82f, 0.3f};
const Rgb kPaleGold{1.0f, 0.95f, 0.75f};
const Rgb kRed{1.0f, 0.12f, 0.08f};
const Rgb kSkin{0.86f, 0.68f, 0.55f};
const Rgb kBlackTie{0.07f, 0.07f, 0.09f};

// Family colours, indexed by agentviz::Action.
const Rgb kFamily[8] = {
    {0.45f, 0.45f, 0.48f},  // none
    {0.72f, 0.36f, 0.16f},  // edit: strings, warm varnish
    {0.95f, 0.50f, 0.12f},  // run: percussion, orange
    {0.25f, 0.70f, 0.40f},  // read: woodwinds, green
    {0.98f, 0.80f, 0.25f},  // web: brass, gold
    {0.92f, 0.92f, 0.96f},  // delegate: the baton, white
    {0.66f, 0.55f, 0.95f},  // think: the pause, lavender
    {0.45f, 0.70f, 0.90f},  // other: bells, steel blue
};

inline Rgb family(Action a) { return kFamily[static_cast<int>(a)]; }
inline Rgb scale(Rgb c, float k) { return {c.r * k, c.g * k, c.b * k}; }
inline Rgb mix(Rgb a, Rgb b, float k) { return {a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k}; }

inline Rgb hue(float seed, float sat, float val) {
    const float h = std::fmod(std::fabs(seed), 1.0f) * 6.0f;
    const int i = static_cast<int>(h) % 6;
    const float f = h - std::floor(h), p = val * (1 - sat), q = val * (1 - sat * f), t = val * (1 - sat * (1 - f));
    switch (i) {
        case 0: return {val, t, p};
        case 1: return {q, val, p};
        case 2: return {p, val, t};
        case 3: return {p, q, val};
        case 4: return {t, p, val};
        default: return {val, p, q};
    }
}

// 0..1..0 at `hz` cycles a second, shifted by `phase` radians.
inline float pulse(float t, float hz, float phase = 0.0f) {
    return 0.5f + 0.5f * std::sin(t * hz * 2.0f * kPi + phase);
}
// The stalled flash: a sharp red beat every second and a half.
inline float stallFlash(float t) { return std::pow(pulse(t, 0.7f), 8.0f); }

inline void box(Host& h, float x, float y, float z, float sx, float sy, float sz, Rgb c) {
    h.add(STRATA_PRIMITIVE_CUBE, x, y, z, sx, sy, sz, c);
}
inline void ball(Host& h, float x, float y, float z, float sx, float sy, float sz, Rgb c) {
    h.add(STRATA_PRIMITIVE_SPHERE, x, y, z, sx, sy, sz, c);
}
inline void disc(Host& h, float x, float y, float z, float d, float thick, Rgb c) {
    h.add(STRATA_PRIMITIVE_CYLINDER, x, y, z, d, thick, d, c);
}

inline void wide(Host& h, float x0, float y0, float z0, float x1, float y1, float z1, Rgb c, float px, float world,
                 float a = 1.0f) {
#if STRATA_ABI_MINOR >= 13
    h.wideLine(x0, y0, z0, x1, y1, z1, c, px, world, a);
#else
    (void)px;
    (void)world;
    h.line(x0, y0, z0, x1, y1, z1, c, a);
#endif
}

inline void ring(Host& h, float x, float y, float z, float r, Rgb c, float px, float a, int seg = 32) {
    for (int k = 0; k < seg; ++k) {
        const float a0 = k * 2 * kPi / seg, a1 = (k + 1) * 2 * kPi / seg;
        wide(h, x + std::cos(a0) * r, y, z + std::sin(a0) * r, x + std::cos(a1) * r, y, z + std::sin(a1) * r, c, px,
             0.0f, a);
    }
}

inline void selectionRing(Host& h, float x, float y, float z, float r, float t, Rgb c = kWhite) {
    const float spin = h.reducedMotion ? 0.0f : t * 0.8f;
    for (int k = 0; k < 24; ++k) {
        const float b0 = k * 2 * kPi / 24 + spin, b1 = (k + 0.6f) * 2 * kPi / 24 + spin;
        wide(h, x + std::cos(b0) * r, y + 0.04f, z + std::sin(b0) * r, x + std::cos(b1) * r, y + 0.04f,
             z + std::sin(b1) * r, c, 3.0f, 0.0f, 0.95f);
    }
}

// Selected: a spinning white ring; hovered: a fainter steel one.
inline void highlightRing(Host& h, agentviz::Highlight hl, float x, float y, float z, float r, float t) {
    if (hl == agentviz::Highlight::Selected) selectionRing(h, x, y, z, r, t);
    else if (hl == agentviz::Highlight::Hovered) selectionRing(h, x, y, z, r, 0.0f, {0.6f, 0.7f, 0.8f});
}

// Where a figure stands and which way it faces; (px, pz) is its right hand.
struct Pose {
    float x, y, z, dx, dz, px, pz;
};
inline Pose poseOf(const agentviz::Agent& a) {
    const float dx = std::sin(a.facing), dz = std::cos(a.facing);
    return {a.x, a.y, a.z, dx, dz, dz, -dx};
}

// The stage's scene floats (agentviz wire header 8..23, see web/orchestra-frame.js).
struct Stage {
    float x0, z0, x1, z1;   // the occupied stage
    float ownerX, ownerZ;   // the owner's gold seat in the front row of the house
    float anyWaiting;       // 0..1, eased by the page
};
inline Stage stageOf(const agentviz::Frame& f) {
    const float* s = f.scene;
    return {s[0], s[1], s[2], s[3], s[4], s[5], agentviz::clamp01(s[6])};
}

// Agent extras (wire agent floats 20..35).
enum Extra { kUp = 0, kWait = 1, kSoloX = 2, kSoloZ = 3, kLeadX = 2, kLeadZ = 3 };
// Link kinds.
enum LinkKind { kThread = 0, kWaitTrail = 1 };

}  // namespace orchestra
