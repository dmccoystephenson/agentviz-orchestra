// agentviz-orchestra: Claude Code sessions as a concert stage.
//
// The page (web/orchestra.js) owns the data and the layout: it reads
// /api/agents, places every ensemble (one per repo), conductor (session) and
// musician (subagent) on the stage, eases between snapshots and writes one
// row per figure each frame. This file only draws those rows: podiums,
// chairs, music stands, instruments by action, spotlights and the hall.
#define STRATA_KIT_MAIN
#include "strata_kit.h"

#include <cmath>
#include <vector>

namespace {

using strata_kit::Host;
using strata_kit::Rgb;

constexpr float kPi = 3.14159265f;
constexpr int kFigStride = 16;
constexpr int kPlaceStride = 8;

// Figure kinds (row[0]).
enum { kConductor = 0, kMusician = 1, kEmptyChair = 2 };
// States (row[6]).
enum { kOffline = 0, kDim = 1, kIdle = 2, kBusy = 3, kWaiting = 4 };
// Actions (row[7]).
enum { kNone = 0, kEdit = 1, kRun = 2, kRead = 3, kWeb = 4, kDelegate = 5, kThink = 6, kOther = 7 };

std::vector<float> figs;    // kFigStride floats per figure
std::vector<float> places;  // kPlaceStride floats per ensemble rug
int figCount = 0, placeCount = 0;
float stage[4] = {-12.0f, -10.0f, 12.0f, 2.0f};  // x0, z0, x1, z1 of the occupied stage
float owner[2] = {0.0f, 7.0f};                    // the owner's seat in the front row
float anyWaiting = 0.0f;                          // 0..1, eased by the page

// Family colours, indexed by action.
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

Rgb scale(Rgb c, float k) { return {c.r * k, c.g * k, c.b * k}; }
Rgb mix(Rgb a, Rgb b, float k) { return {a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k}; }

Rgb hue(float seed, float sat, float val) {
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

float pulse(double t, float hz, float phase = 0.0f) {
    return 0.5f + 0.5f * std::sin(static_cast<float>(t) * hz * 2.0f * kPi + phase);
}

void wide(Host& h, float x0, float y0, float z0, float x1, float y1, float z1, Rgb c, float px, float world,
          float a = 1.0f) {
#if STRATA_ABI_MINOR >= 13
    h.wideLine(x0, y0, z0, x1, y1, z1, c, px, world, a);
#else
    (void)px;
    (void)world;
    h.line(x0, y0, z0, x1, y1, z1, c, a);
#endif
}

void ring(Host& h, float x, float y, float z, float r, Rgb c, float px, float a, int seg = 32) {
    for (int k = 0; k < seg; ++k) {
        const float a0 = k * 2 * kPi / seg, a1 = (k + 1) * 2 * kPi / seg;
        wide(h, x + std::cos(a0) * r, y, z + std::sin(a0) * r, x + std::cos(a1) * r, y, z + std::sin(a1) * r, c, px,
             0.0f, a);
    }
}

// A chair: seat plus a back on the side away from `dir`.
void chair(Host& h, float x, float y, float z, float dx, float dz, Rgb c) {
    h.add(STRATA_PRIMITIVE_CUBE, x, y + 0.45f, z, 0.46f, 0.06f, 0.46f, c);
    for (int lx = -1; lx <= 1; lx += 2)
        for (int lz = -1; lz <= 1; lz += 2)
            h.add(STRATA_PRIMITIVE_CUBE, x + lx * 0.19f, y + 0.21f, z + lz * 0.19f, 0.05f, 0.42f, 0.05f,
                  scale(c, 0.6f));
    const bool alongX = std::fabs(dx) > std::fabs(dz);
    const float bx = x - dx * 0.22f, bz = z - dz * 0.22f;
    h.add(STRATA_PRIMITIVE_CUBE, bx, y + 0.75f, bz, alongX ? 0.05f : 0.46f, 0.55f, alongX ? 0.46f : 0.05f, c);
}

// Soft music notes drifting up from (x, y, z).
void notes(Host& h, float x, float y, float z, Rgb c, double t, float seed, int n, float strength) {
    for (int k = 0; k < n; ++k) {
        const float life = std::fmod(static_cast<float>(t) * 0.5f + seed * 7.0f + k / static_cast<float>(n), 1.0f);
        const float sway = std::sin(life * 6.0f + seed * 20.0f + k) * 0.25f;
        const float a = (1.0f - life) * std::min(life * 5.0f, 1.0f) * strength;
        h.point(x + sway, y + life * 1.6f, z + std::cos(life * 5.0f + k) * 0.15f, 9.0f, 0.14f, c, a);
    }
}

// The family's instrument for a figure whose chest is at (cx, cy, cz),
// facing (dx, dz), with (px, pz) its right. up: 0 resting on the floor .. 1
// playing. Returns the point the sound comes from (for notes).
void instrument(Host& h, int action, float cx, float cy, float cz, float dx, float dz, float up, double t,
                float seed, float floorY, float* sx, float* sy, float* sz) {
    const float px = dz, pz = -dx;  // right-hand side
    const Rgb fam = kFamily[action < 0 || action > 7 ? 0 : action];
    *sx = cx + dx * 0.4f;
    *sy = cy + 0.4f;
    *sz = cz + dz * 0.4f;
    const float ph = seed * 13.0f;
    if (up < 0.5f || action == kNone) {
        // Down: the instrument rests on the floor beside the chair.
        const Rgb c = action == kNone ? Rgb{0.30f, 0.20f, 0.12f} : scale(fam, 0.7f);
        h.add(STRATA_PRIMITIVE_CUBE, cx + px * 0.45f, floorY + 0.07f, cz + pz * 0.45f, 0.22f, 0.12f, 0.22f, c);
        return;
    }
    switch (action) {
        case kEdit: {  // strings: a cello between the knees, bowing
            const float bx = cx + dx * 0.32f, bz = cz + dz * 0.32f, by = cy - 0.12f;
            h.add(STRATA_PRIMITIVE_SPHERE, bx, by, bz, 0.30f, 0.46f, 0.30f, {0.50f, 0.22f, 0.08f});
            h.add(STRATA_PRIMITIVE_SPHERE, bx, by + 0.18f, bz, 0.24f, 0.26f, 0.24f, {0.55f, 0.25f, 0.09f});
            wide(h, bx, by + 0.15f, bz, bx, by + 0.85f, bz, {0.12f, 0.07f, 0.04f}, 3.0f, 0.04f);
            const float s = std::sin(static_cast<float>(t) * 5.0f + ph) * 0.28f;
            const float ex = bx + dx * 0.12f, ez = bz + dz * 0.12f, ey = by + 0.05f;
            wide(h, ex + px * (s - 0.35f), ey + 0.06f, ez + pz * (s - 0.35f), ex + px * (s + 0.35f), ey - 0.04f,
                 ez + pz * (s + 0.35f), {0.92f, 0.85f, 0.65f}, 2.5f, 0.02f);
            *sx = bx;
            *sy = by + 0.4f;
            *sz = bz;
            break;
        }
        case kRun: {  // percussion: a drum, sticks hitting
            const float bx = cx + dx * 0.45f, bz = cz + dz * 0.45f, top = cy - 0.12f;
            h.add(STRATA_PRIMITIVE_CYLINDER, bx, top - 0.14f, bz, 0.55f, 0.14f, 0.55f, {0.75f, 0.20f, 0.12f});
            h.add(STRATA_PRIMITIVE_CYLINDER, bx, top + 0.005f, bz, 0.52f, 0.01f, 0.52f, {0.92f, 0.88f, 0.78f});
            for (int side = -1; side <= 1; side += 2) {
                const float beat = std::sin(static_cast<float>(t) * 7.0f + ph + (side > 0 ? kPi : 0.0f));
                const float lift = std::max(beat, 0.0f) * 0.32f;
                const float hx = cx + dx * 0.2f + px * side * 0.2f, hz = cz + dz * 0.2f + pz * side * 0.2f;
                const float tx = bx + px * side * 0.12f, tz = bz + pz * side * 0.12f;
                wide(h, hx, cy + 0.02f, hz, tx, top + 0.03f + lift, tz, {0.85f, 0.75f, 0.55f}, 2.5f, 0.025f);
                if (beat < -0.8f) h.point(tx, top + 0.06f, tz, 22.0f, 0.3f, {1.0f, 0.75f, 0.35f}, 0.8f);
            }
            *sx = bx;
            *sy = top;
            *sz = bz;
            break;
        }
        case kRead: {  // woodwinds: a clarinet from the lips, angled down
            const float mx = cx + dx * 0.16f, mz = cz + dz * 0.16f, my = cy + 0.38f;
            const float sway = std::sin(static_cast<float>(t) * 1.6f + ph) * 0.06f;
            const float ex = cx + dx * 0.55f + px * sway, ez = cz + dz * 0.55f + pz * sway, ey = cy - 0.15f;
            wide(h, mx, my, mz, ex, ey, ez, {0.08f, 0.10f, 0.08f}, 4.0f, 0.05f);
            h.add(STRATA_PRIMITIVE_SPHERE, ex, ey, ez, 0.12f, 0.08f, 0.12f, {0.15f, 0.45f, 0.25f});
            for (int k = 1; k < 4; ++k) {
                const float f = k / 4.0f;
                h.point(mx + (ex - mx) * f, my + (ey - my) * f, mz + (ez - mz) * f, 4.0f, 0.03f,
                        {0.85f, 0.88f, 0.9f}, 0.9f, 0);
            }
            *sx = ex;
            *sy = ey;
            *sz = ez;
            break;
        }
        case kWeb: {  // brass: a horn raised, its bell catching the light
            const float lift = 0.1f + 0.05f * std::sin(static_cast<float>(t) * 2.2f + ph);
            const float mx = cx + dx * 0.16f, mz = cz + dz * 0.16f, my = cy + 0.38f;
            const float ex = cx + dx * 0.85f, ez = cz + dz * 0.85f, ey = my + lift;
            wide(h, mx, my, mz, ex, ey, ez, {0.85f, 0.65f, 0.18f}, 4.5f, 0.05f);
            h.add(STRATA_PRIMITIVE_SPHERE, ex, ey, ez, 0.24f, 0.24f, 0.24f, {0.95f, 0.72f, 0.20f});
            h.add(STRATA_PRIMITIVE_CYLINDER, (mx + ex) * 0.5f, my - 0.08f, (mz + ez) * 0.5f, 0.12f, 0.06f, 0.12f,
                  {0.8f, 0.6f, 0.15f});
            *sx = ex;
            *sy = ey;
            *sz = ez;
            break;
        }
        case kDelegate: {  // a small baton
            const float s = std::sin(static_cast<float>(t) * 3.0f + ph);
            const float hx = cx + dx * 0.3f + px * s * 0.2f, hz = cz + dz * 0.3f + pz * s * 0.2f;
            const float hy = cy + 0.25f + 0.12f * std::fabs(std::cos(static_cast<float>(t) * 3.0f + ph));
            wide(h, hx, hy, hz, hx + dx * 0.25f + px * s * 0.15f, hy + 0.35f, hz + dz * 0.25f + pz * s * 0.15f,
                 {0.98f, 0.98f, 1.0f}, 2.5f, 0.015f);
            *sx = hx;
            *sy = hy + 0.35f;
            *sz = hz;
            break;
        }
        case kThink: {  // holding still, the instrument on the lap
            h.add(STRATA_PRIMITIVE_CUBE, cx + dx * 0.2f, cy - 0.2f, cz + dz * 0.2f, 0.3f, 0.06f, 0.3f,
                  scale(fam, 0.6f));
            *sx = cx;
            *sy = cy + 0.65f;
            *sz = cz;
            break;
        }
        default: {  // other: a triangle and its beater
            const float bx = cx + dx * 0.4f, bz = cz + dz * 0.4f, by = cy + 0.1f;
            const Rgb steel{0.75f, 0.85f, 0.95f};
            const float r = 0.17f;
            const float ax = bx + px * -r, az = bz + pz * -r, bx2 = bx + px * r, bz2 = bz + pz * r;
            wide(h, bx, by + r * 1.6f, bz, ax, by, az, steel, 2.5f, 0.02f);
            wide(h, ax, by, az, bx2, by, bz2, steel, 2.5f, 0.02f);
            wide(h, bx2, by, bz2, bx, by + r * 1.6f, bz, steel, 2.5f, 0.02f);
            const float hit = std::sin(static_cast<float>(t) * 4.0f + ph);
            wide(h, bx + px * 0.25f, by + 0.15f + hit * 0.08f, bz + pz * 0.25f, bx + px * 0.05f, by + 0.12f,
                 bz + pz * 0.05f, {0.6f, 0.6f, 0.65f}, 2.0f, 0.015f);
            if (hit > 0.9f) h.point(bx, by + 0.2f, bz, 16.0f, 0.2f, steel, 0.7f);
            *sx = bx;
            *sy = by + 0.2f;
            *sz = bz;
            break;
        }
    }
}

// A music stand between a musician and the conductor: a pole and a plate in
// the family colour, lit while playing.
void musicStand(Host& h, float x, float y, float z, float dx, float dz, int action, float up) {
    h.add(STRATA_PRIMITIVE_CYLINDER, x, y + 0.45f, z, 0.04f, 0.45f, 0.04f, {0.12f, 0.12f, 0.13f});
    const bool alongX = std::fabs(dx) > std::fabs(dz);
    const Rgb fam = kFamily[action < 0 || action > 7 ? 0 : action];
    const Rgb plate = up > 0.5f ? fam : scale(fam, 0.35f);
    h.add(STRATA_PRIMITIVE_CUBE, x, y + 0.98f, z, alongX ? 0.04f : 0.44f, 0.3f, alongX ? 0.44f : 0.04f, plate);
    if (up > 0.5f) h.point(x, y + 1.02f, z, 10.0f, 0.25f, fam, 0.35f);
}

void selectionRing(Host& h, float x, float y, float z, float r, double t) {
    const float spin = h.reducedMotion ? 0.0f : static_cast<float>(t) * 0.8f;
    for (int k = 0; k < 24; ++k) {
        const float b0 = k * 2 * kPi / 24 + spin, b1 = (k + 0.6f) * 2 * kPi / 24 + spin;
        wide(h, x + std::cos(b0) * r, y + 0.04f, z + std::sin(b0) * r, x + std::cos(b1) * r, y + 0.04f,
             z + std::sin(b1) * r, {1.0f, 1.0f, 1.0f}, 3.0f, 0.0f, 0.95f);
    }
}

void drawConductor(Host& h, const float* r, double t) {
    const float x = r[1], y = r[2], z = r[3], dx = r[4], dz = r[5];
    const int state = static_cast<int>(r[6]), action = static_cast<int>(r[7]);
    const float seed = r[8], sel = r[9], up = r[10], wait = r[11], stalled = r[12];
    const float px = dz, pz = -dx;
    const Rgb accent = hue(seed, 0.65f, 0.9f);
    const bool busy = state == kBusy;
    const float bright = state == kDim ? 0.5f : 1.0f;

    // Spotlight pool and podium.
    const float poolK = wait > 0.01f ? 0.8f + 0.2f * wait : (busy ? 0.75f : (state == kIdle ? 0.42f : 0.25f));
    Rgb pool = mix({0.95f, 0.82f, 0.58f}, {1.0f, 0.95f, 0.7f}, wait);
    if (stalled > 0.5f) {
        const float flash = std::pow(pulse(t, 0.7f), 8.0f);
        pool = mix(pool, {1.0f, 0.1f, 0.08f}, flash);
    }
    h.add(STRATA_PRIMITIVE_CYLINDER, x, y + 0.012f, z, 2.6f, 0.01f, 2.6f, scale(pool, poolK));
    h.add(STRATA_PRIMITIVE_CUBE, x, y + 0.17f, z, 1.0f, 0.34f, 1.0f, {0.16f, 0.10f, 0.07f});
    h.add(STRATA_PRIMITIVE_CUBE, x, y + 0.345f, z, 1.04f, 0.02f, 1.04f, scale(accent, 0.55f));
    const float fy = y + 0.35f;

    // Body, head, hair, a coloured sash so the ensemble reads as one.
    const float bow = wait > 0.5f ? 0.08f * pulse(t, 0.5f) : 0.0f;
    h.add(STRATA_PRIMITIVE_CAPSULE, x, fy + 0.55f, z, 0.5f, 0.42f, 0.5f, scale({0.07f, 0.07f, 0.09f}, bright));
    h.add(STRATA_PRIMITIVE_CUBE, x + dx * 0.2f, fy + 0.78f, z + dz * 0.2f, 0.18f, 0.12f, 0.18f, accent);
    const float hx = x + dx * bow, hz = z + dz * bow, hy = fy + 1.18f - bow;
    h.add(STRATA_PRIMITIVE_SPHERE, hx, hy, hz, 0.34f, 0.36f, 0.34f, scale({0.86f, 0.68f, 0.55f}, bright));
    h.add(STRATA_PRIMITIVE_SPHERE, hx - dx * 0.05f, hy + 0.08f, hz - dz * 0.05f, 0.33f, 0.24f, 0.33f,
          hue(seed + 0.37f, 0.35f, 0.35f));
    h.add(STRATA_PRIMITIVE_SPHERE, hx + dx * 0.17f, hy - 0.01f, hz + dz * 0.17f, 0.07f, 0.07f, 0.07f,
          {0.8f, 0.6f, 0.5f});
    if (wait > 0.5f)  // a white bow tie: the conductor has turned to the audience
        h.add(STRATA_PRIMITIVE_CUBE, x + dx * 0.25f, fy + 0.93f, z + dz * 0.25f, 0.16f, 0.07f, 0.16f,
              {1.0f, 1.0f, 1.0f});

    // Arms and baton.
    const float sy = fy + 0.88f;
    const float lsx = x - px * 0.26f, lsz = z - pz * 0.26f, rsx = x + px * 0.26f, rsz = z + pz * 0.26f;
    const Rgb sleeve = scale({0.09f, 0.09f, 0.11f}, bright);
    float rhx, rhy, rhz, lhx, lhy, lhz;
    const float tt = static_cast<float>(t);
    if (wait > 0.5f) {  // arms open to the audience
        const float o = 0.06f * pulse(t, 0.5f);
        rhx = rsx + px * (0.35f + o) + dx * 0.25f;
        rhz = rsz + pz * (0.35f + o) + dz * 0.25f;
        lhx = lsx - px * (0.35f + o) + dx * 0.25f;
        lhz = lsz - pz * (0.35f + o) + dz * 0.25f;
        rhy = lhy = sy + 0.15f;
    } else if (busy && action == kDelegate) {  // the beat pattern
        const float s = std::sin(tt * 3.0f + seed * 9.0f), c = std::fabs(std::cos(tt * 3.0f + seed * 9.0f));
        rhx = rsx + dx * 0.4f + px * s * 0.3f;
        rhz = rsz + dz * 0.4f + pz * s * 0.3f;
        rhy = sy + 0.05f + c * 0.35f;
        lhx = lsx + dx * 0.35f - px * s * 0.1f;
        lhz = lsz + dz * 0.35f - pz * s * 0.1f;
        lhy = sy + 0.1f + c * 0.15f;
    } else if (busy && action == kThink) {  // the held pause: hands up, still
        const float b = 0.02f * std::sin(tt * 1.2f);
        rhx = rsx + dx * 0.3f + px * 0.08f;
        rhz = rsz + dz * 0.3f + pz * 0.08f;
        lhx = lsx + dx * 0.3f - px * 0.08f;
        lhz = lsz + dz * 0.3f - pz * 0.08f;
        rhy = lhy = sy + 0.42f + b;
    } else if (busy && up > 0.5f) {  // playing an instrument: hands forward
        rhx = rsx + dx * 0.32f;
        rhz = rsz + dz * 0.32f;
        lhx = lsx + dx * 0.32f;
        lhz = lsz + dz * 0.32f;
        rhy = lhy = sy - 0.18f;
    } else {  // at rest: arms by the sides
        rhx = rsx + px * 0.04f;
        rhz = rsz + pz * 0.04f;
        lhx = lsx - px * 0.04f;
        lhz = lsz - pz * 0.04f;
        rhy = lhy = sy - 0.5f;
    }
    wide(h, rsx, sy, rsz, rhx, rhy, rhz, sleeve, 5.0f, 0.12f);
    wide(h, lsx, sy, lsz, lhx, lhy, lhz, sleeve, 5.0f, 0.12f);
    h.add(STRATA_PRIMITIVE_SPHERE, rhx, rhy, rhz, 0.1f, 0.1f, 0.1f, {0.86f, 0.68f, 0.55f});
    h.add(STRATA_PRIMITIVE_SPHERE, lhx, lhy, lhz, 0.1f, 0.1f, 0.1f, {0.86f, 0.68f, 0.55f});
    if (wait <= 0.5f && (action == kDelegate || action == kThink || action == kNone || !busy)) {
        const float bxe = rhx + (rhx - rsx) * 0.9f + (busy ? 0.0f : dx * 0.1f);
        const float bze = rhz + (rhz - rsz) * 0.9f;
        const float bye = rhy + (busy ? 0.45f : -0.25f);
        wide(h, rhx, rhy, rhz, bxe, bye, bze, {0.98f, 0.98f, 1.0f}, 2.5f, 0.015f);
        if (busy && action == kDelegate) h.point(bxe, bye, bze, 9.0f, 0.12f, {1.0f, 1.0f, 0.9f}, 0.8f);
    }

    // The conductor plays the family's instrument when working alone.
    if (wait <= 0.5f && busy && action != kDelegate && action != kThink) {
        float nx, ny, nz;
        instrument(h, action, x, fy + 0.55f, z, dx, dz, up, t, seed, fy, &nx, &ny, &nz);
        notes(h, nx, ny, nz, kFamily[action], t, seed, 3, 0.9f);
    }
    if (busy && action == kThink && wait <= 0.5f) {  // a fermata: three slow lavender dots
        for (int k = 0; k < 3; ++k) {
            const float a = tt * 0.6f + k * 2.1f;
            h.point(x + std::cos(a) * 0.35f, fy + 1.75f + 0.05f * std::sin(tt + k), z + std::sin(a) * 0.35f, 10.0f,
                    0.16f, kFamily[kThink], 0.85f);
        }
    }

    // Busy: a warm spot over the podium.
    if (busy && wait < 0.5f)
        h.light(x + dx * 0.3f, fy + 3.2f, z + dz * 0.3f, 6.0f, {1.0f, 0.86f, 0.62f}, 1.4f, 3);

    // Waiting: the solo chair under a bright spotlight, the conductor facing
    // the owner's seat, a pulsing ring and a lit path out to the audience.
    if (wait > 0.01f) {
        const float cx = r[14], cz = r[15];
        const float p = pulse(t, 0.9f);
        h.add(STRATA_PRIMITIVE_CYLINDER, cx, y + 0.016f, cz, 1.9f, 0.012f, 1.9f,
              scale({1.0f, 0.95f, 0.75f}, 0.6f + 0.4f * wait));
        chair(h, cx, y, cz, -dx, -dz, scale({0.95f, 0.75f, 0.25f}, 0.6f + 0.4f * wait));
        for (int k = 0; k < 14; ++k) {
            const float f = k / 13.0f;
            h.point(cx, y + 0.3f + f * 7.0f, cz, 50.0f + 40.0f * f, 0.6f + f * 1.4f, {1.0f, 0.95f, 0.75f},
                    (0.16f - f * 0.08f) * wait);
        }
        h.light(cx, y + 3.0f, cz, 7.0f, {1.0f, 0.95f, 0.8f}, (2.5f + 1.0f * p) * wait, 10);
        ring(h, x, y + 0.05f, z, 1.4f + 0.25f * p, {1.0f, 0.85f, 0.3f}, 4.0f, (0.5f + 0.5f * p) * wait);
        ring(h, cx, y + 0.05f, cz, 1.0f + 0.15f * (1.0f - p), {1.0f, 0.95f, 0.7f}, 3.0f, 0.8f * wait);
        h.point(x, fy + 2.2f, z, 40.0f + 25.0f * p, 0.9f, {1.0f, 0.82f, 0.3f}, (0.45f + 0.35f * p) * wait);
        // Dots walking from the podium to the owner's seat.
        const float ox = owner[0], oz = owner[1];
        for (int k = 0; k < 12; ++k) {
            const float f = std::fmod(k / 12.0f + static_cast<float>(t) * 0.25f, 1.0f);
            const float arc = std::sin(f * kPi) * 1.2f;
            h.point(x + (ox - x) * f, y + 0.6f + (-0.3f - y) * f + arc, z + (oz - z) * f, 12.0f, 0.18f,
                    {1.0f, 0.85f, 0.35f}, 0.8f * wait * std::sin(f * kPi));
        }
    }

    // Stalled: a wrong note, a red flash every second and a half.
    if (stalled > 0.5f) {
        const float flash = std::pow(pulse(t, 0.7f), 8.0f);
        h.point(x, fy + 1.9f, z, 30.0f + 30.0f * flash, 0.6f, {1.0f, 0.12f, 0.08f}, 0.2f + 0.7f * flash);
        h.add(STRATA_PRIMITIVE_SPHERE, x + 0.25f, fy + 1.85f + flash * 0.2f, z, 0.16f, 0.13f, 0.16f,
              {0.9f, 0.08f, 0.06f});
        wide(h, x + 0.32f, fy + 1.85f + flash * 0.2f, z, x + 0.32f, fy + 2.25f + flash * 0.2f, z,
             {0.9f, 0.08f, 0.06f}, 3.0f, 0.03f);
        if (flash > 0.2f) h.light(x, fy + 2.0f, z, 5.0f, {1.0f, 0.1f, 0.05f}, 3.0f * flash, 7);
    }
    if (sel > 0.5f) selectionRing(h, x, y, z, 1.5f, t);
}

void drawMusician(Host& h, const float* r, double t) {
    const float x = r[1], y = r[2], z = r[3], dx = r[4], dz = r[5];
    const int state = static_cast<int>(r[6]), action = static_cast<int>(r[7]);
    const float seed = r[8], sel = r[9], up = r[10];
    const float tx = r[14], tz = r[15];
    const Rgb accent = hue(r[13], 0.55f, 0.75f);  // the conductor's colour: chair and cushion
    const bool active = state == kBusy && up > 0.5f;

    chair(h, x, y, z, dx, dz, scale(accent, 0.55f));
    h.add(STRATA_PRIMITIVE_CUBE, x, y + 0.49f, z, 0.4f, 0.03f, 0.4f, accent);
    const float bright = active ? 1.0f : 0.75f;
    h.add(STRATA_PRIMITIVE_CAPSULE, x, y + 0.8f, z, 0.42f, 0.3f, 0.42f, scale({0.08f, 0.08f, 0.1f}, bright));
    const float nod = active ? 0.03f * std::sin(static_cast<float>(t) * 3.0f + seed * 11.0f) : -0.04f;
    const float hx = x + dx * 0.02f, hz = z + dz * 0.02f, hy = y + 1.2f + nod;
    h.add(STRATA_PRIMITIVE_SPHERE, hx, hy, hz, 0.3f, 0.32f, 0.3f, scale({0.85f, 0.66f, 0.52f}, bright));
    h.add(STRATA_PRIMITIVE_SPHERE, hx - dx * 0.05f, hy + 0.07f, hz - dz * 0.05f, 0.29f, 0.2f, 0.29f,
          hue(seed + 0.5f, 0.4f, 0.4f));
    h.add(STRATA_PRIMITIVE_SPHERE, hx + dx * 0.15f, hy - 0.01f, hz + dz * 0.15f, 0.06f, 0.06f, 0.06f,
          {0.8f, 0.6f, 0.5f});

    float nx, ny, nz;
    instrument(h, action, x, y + 0.8f, z, dx, dz, state == kBusy ? up : 0.0f, t, seed, y, &nx, &ny, &nz);
    if (active && action != kThink) notes(h, nx, ny, nz, kFamily[action], t, seed, 3, 0.85f);
    if (active && action == kThink)
        h.point(x, y + 1.6f + 0.05f * std::sin(static_cast<float>(t) * 1.3f), z, 10.0f, 0.14f, kFamily[kThink],
                0.8f);

    // The stand, between the musician and the conductor.
    const float vx = tx - x, vz = tz - z, len = std::max(std::sqrt(vx * vx + vz * vz), 0.01f);
    const float sx = x + vx / len * 0.85f, sz = z + vz / len * 0.85f;
    musicStand(h, sx, y, sz, vx / len, vz / len, action, active ? 1.0f : 0.0f);
    // A faint thread from the stand to the podium: this musician's conductor.
    wide(h, sx, y + 0.03f, sz, tx, y + 0.03f, tz, accent, 1.5f, 0.0f, active ? 0.35f : 0.15f);
    if (sel > 0.5f) selectionRing(h, x, y, z, 0.7f, t);
}

void drawEmptyChair(Host& h, const float* r, double t) {
    const float x = r[1], y = r[2], z = r[3], dx = r[4], dz = r[5];
    chair(h, x, y, z, dx, dz, {0.22f, 0.18f, 0.16f});
    // An instrument case on the floor beside it, closed.
    const float px = dz, pz = -dx;
    h.add(STRATA_PRIMITIVE_CUBE, x + px * 0.6f, y + 0.13f, z + pz * 0.6f, std::fabs(px) > 0.5f ? 0.3f : 0.95f,
          0.24f, std::fabs(px) > 0.5f ? 0.95f : 0.3f, {0.17f, 0.11f, 0.08f});
    h.add(STRATA_PRIMITIVE_CUBE, x + px * 0.6f, y + 0.27f, z + pz * 0.6f, 0.12f, 0.04f, 0.12f, {0.5f, 0.45f, 0.35f});
    h.add(STRATA_PRIMITIVE_CUBE, x, y + 0.17f, z + dz * 0.7f, 0.8f, 0.34f, 0.8f, {0.11f, 0.08f, 0.06f});
    if (r[9] > 0.5f) selectionRing(h, x, y, z, 1.0f, t);
}

void drawHall(Host& h, double t) {
    const float x0 = stage[0] - 4.0f, x1 = stage[2] + 4.0f, z0 = stage[1] - 4.0f, z1 = stage[3] + 3.0f;
    const float cx = (x0 + x1) * 0.5f, w = x1 - x0, d = z1 - z0, cz = (z0 + z1) * 0.5f;
    // Stage floor (top at y = 0) and its front face.
    h.add(STRATA_PRIMITIVE_CUBE, cx, -0.6f, cz, w, 1.2f, d, {0.34f, 0.21f, 0.11f});
    h.add(STRATA_PRIMITIVE_CUBE, cx, -0.6f, z1 + 0.02f, w, 1.2f, 0.06f, {0.12f, 0.06f, 0.05f});
    for (float bx = x0 + 1.0f; bx < x1; bx += 2.0f)  // boards
        h.line(bx, 0.005f, z0, bx, 0.005f, z1, {0.24f, 0.14f, 0.07f}, 0.6f);
    // Curtains: the back drop and the wings.
    const Rgb velvet{0.36f, 0.04f, 0.06f};
    h.add(STRATA_PRIMITIVE_CUBE, cx, 4.0f, z0 - 0.3f, w + 4.0f, 9.0f, 0.4f, velvet);
    for (float fx = x0 - 1.5f; fx < x1 + 2.0f; fx += 1.2f)
        h.add(STRATA_PRIMITIVE_CYLINDER, fx, 4.0f, z0 - 0.05f, 0.5f, 4.5f, 0.25f, scale(velvet, 1.15f));
    h.add(STRATA_PRIMITIVE_CUBE, x0 - 1.0f, 4.0f, z1 - 1.0f, 1.2f, 9.0f, 2.5f, velvet);
    h.add(STRATA_PRIMITIVE_CUBE, x1 + 1.0f, 4.0f, z1 - 1.0f, 1.2f, 9.0f, 2.5f, velvet);
    // Footlights along the front edge.
    for (float fx = x0 + 0.8f; fx < x1; fx += 1.6f) {
        h.add(STRATA_PRIMITIVE_SPHERE, fx, 0.08f, z1 - 0.25f, 0.16f, 0.12f, 0.16f, {1.0f, 0.85f, 0.55f});
        h.point(fx, 0.12f, z1 - 0.25f, 14.0f, 0.4f, {1.0f, 0.8f, 0.5f}, 0.35f);
    }
    // The house: an aisle of seats in front of the stage, and the owner's seat.
    const Rgb seat{0.42f, 0.06f, 0.08f};
    h.add(STRATA_PRIMITIVE_CUBE, cx, -1.3f, z1 + 8.0f, w + 6.0f, 0.2f, 16.0f, {0.10f, 0.05f, 0.05f});
    for (int row = 0; row < 6; ++row) {
        const float sz = z1 + 3.0f + row * 1.7f, sy = -1.2f + row * 0.35f;
        h.add(STRATA_PRIMITIVE_CUBE, cx, sy - 0.1f, sz + 0.2f, w + 6.0f, 0.2f + row * 0.7f, 1.7f,
              {0.10f, 0.05f, 0.05f});
        for (float sx = x0 - 2.0f; sx < x1 + 2.0f; sx += 1.0f) {
            if (std::fabs(sx - owner[0]) < 0.5f && row == 0) continue;
            if (std::fabs(sx - cx) < 0.9f && row > 0) continue;  // the aisle
            h.add(STRATA_PRIMITIVE_CUBE, sx, sy + 0.25f, sz, 0.8f, 0.12f, 0.7f, seat);
            h.add(STRATA_PRIMITIVE_CUBE, sx, sy + 0.55f, sz + 0.35f, 0.8f, 0.7f, 0.1f, scale(seat, 0.8f));
        }
    }
    // The owner's seat: gold, and it glows while anyone waits on them.
    const float ox = owner[0], oz = owner[1], oy = -1.2f;
    const float p = pulse(t, 0.9f);
    const Rgb gold = mix({0.55f, 0.42f, 0.15f}, {1.0f, 0.82f, 0.3f}, anyWaiting * p);
    h.add(STRATA_PRIMITIVE_CUBE, ox, oy + 0.28f, oz, 0.95f, 0.16f, 0.85f, gold);
    h.add(STRATA_PRIMITIVE_CUBE, ox, oy + 0.65f, oz + 0.4f, 0.95f, 0.9f, 0.12f, gold);
    if (anyWaiting > 0.01f) {
        h.point(ox, oy + 1.2f, oz, 40.0f + 30.0f * p, 1.0f, {1.0f, 0.85f, 0.35f}, (0.3f + 0.4f * p) * anyWaiting);
        ring(h, ox, oy + 0.42f, oz, 0.9f + 0.2f * p, {1.0f, 0.85f, 0.3f}, 3.0f, anyWaiting);
        h.light(ox, oy + 2.0f, oz, 5.0f, {1.0f, 0.85f, 0.5f}, 2.0f * anyWaiting, 9);
    }
    // House lights: fills that become ambient on the lowest tier.
    StrataPointLight l{};
    l.range = std::max(w, d) * 0.9f;
    l.intensity = 0.9f;
    l.color[0] = 1.0f;
    l.color[1] = 0.85f;
    l.color[2] = 0.65f;
    l.position[0] = cx;
    l.position[1] = 7.0f;
    l.position[2] = z1 + 1.0f;
    h.fill(l, {0.10f, 0.08f, 0.06f}, 2);
}

}  // namespace

void strata_kit_configure(strata_kit::Options& o) {
    o.name = "agentviz-orchestra";
    o.fog = false;
}

void strata_kit_engine_ready(strata_kit::Host&) {}

void strata_kit_build(Host& h, double t) {
    // An indoor hall: a dark house, a low warm key light and the spots.
    h.clearFlags = STRATA_CLEAR_COLOR | STRATA_CLEAR_DEPTH;
    h.clearColor[0] = 0.025f;
    h.clearColor[1] = 0.018f;
    h.clearColor[2] = 0.03f;
    h.clearColor[3] = 1.0f;
    h.sunIntensity = 0.55f;
    h.sunTint = {1.0f, 0.88f, 0.72f};
    h.ambientTint = {0.75f, 0.68f, 0.72f};

    drawHall(h, t);
    for (int i = 0; i < placeCount; ++i) {
        const float* p = &places[static_cast<size_t>(i) * kPlaceStride];
        const float px0 = p[0], pz0 = p[1], px1 = p[2], pz1 = p[3], py = p[4];
        const Rgb c = hue(p[5], 0.45f, 0.42f);
        if (py > 0.01f)
            h.add(STRATA_PRIMITIVE_CUBE, (px0 + px1) * 0.5f, py * 0.5f, (pz0 + pz1) * 0.5f, px1 - px0, py, pz1 - pz0,
                  {0.22f, 0.13f, 0.07f});
        h.add(STRATA_PRIMITIVE_CUBE, (px0 + px1) * 0.5f, py + 0.005f, (pz0 + pz1) * 0.5f, px1 - px0 - 0.2f, 0.01f,
              pz1 - pz0 - 0.2f, c);
        if (p[6] > 0.5f) {  // an ensemble with someone waiting: its rug edge pulses gold
            const float k = pulse(t, 0.9f);
            const Rgb g{1.0f, 0.82f, 0.3f};
            wide(h, px0, py + 0.03f, pz1, px1, py + 0.03f, pz1, g, 3.0f, 0.0f, 0.4f + 0.6f * k);
            wide(h, px0, py + 0.03f, pz0, px0, py + 0.03f, pz1, g, 3.0f, 0.0f, 0.4f + 0.6f * k);
            wide(h, px1, py + 0.03f, pz0, px1, py + 0.03f, pz1, g, 3.0f, 0.0f, 0.4f + 0.6f * k);
            wide(h, px0, py + 0.03f, pz0, px1, py + 0.03f, pz0, g, 3.0f, 0.0f, 0.4f + 0.6f * k);
        }
    }
    for (int i = 0; i < figCount; ++i) {
        const float* r = &figs[static_cast<size_t>(i) * kFigStride];
        switch (static_cast<int>(r[0])) {
            case kConductor: drawConductor(h, r, t); break;
            case kMusician: drawMusician(h, r, t); break;
            default: drawEmptyChair(h, r, t); break;
        }
    }
}

// The occupied stage (x0, z0, x1, z1), the owner's seat and how much anyone
// is waiting (0..1, eased by the page).
STRATA_KIT_EXPORT void orc_set_stage(float x0, float z0, float x1, float z1, float ox, float oz, float waiting) {
    stage[0] = x0;
    stage[1] = z0;
    stage[2] = x1;
    stage[3] = z1;
    owner[0] = ox;
    owner[1] = oz;
    anyWaiting = waiting;
}

// Ensemble rugs: kPlaceStride floats each (x0, z0, x1, z1, riser y, seed, waiting, busy).
STRATA_KIT_EXPORT void orc_set_places(const float* rows, int count) {
    placeCount = count < 0 ? 0 : count;
    places.assign(rows, rows + static_cast<size_t>(placeCount) * kPlaceStride);
}

// Figures: kFigStride floats each; see web/orchestra.js (writeFrame) for the layout.
STRATA_KIT_EXPORT void orc_set_figures(const float* rows, int count) {
    figCount = count < 0 ? 0 : count;
    figs.assign(rows, rows + static_cast<size_t>(figCount) * kFigStride);
}
