// hall.h: the concert hall around the ensembles: stage floor, curtains,
// footlights, the house with the owner's gold seat, and each ensemble's rug.
#pragma once

#include <vector>

#include "draw_util.h"

namespace orchestra {

inline void drawStageFloor(Host& h, float x0, float z0, float x1, float z1) {
    const float cx = (x0 + x1) * 0.5f, w = x1 - x0, d = z1 - z0, cz = (z0 + z1) * 0.5f;
    box(h, cx, -0.6f, cz, w, 1.2f, d, {0.34f, 0.21f, 0.11f});
    box(h, cx, -0.6f, z1 + 0.02f, w, 1.2f, 0.06f, {0.12f, 0.06f, 0.05f});
    for (float bx = x0 + 1.0f; bx < x1; bx += 2.0f)  // boards
        h.line(bx, 0.005f, z0, bx, 0.005f, z1, {0.24f, 0.14f, 0.07f}, 0.6f);
}

inline void drawCurtains(Host& h, float x0, float z0, float x1, float z1) {
    const float cx = (x0 + x1) * 0.5f, w = x1 - x0;
    const Rgb velvet{0.36f, 0.04f, 0.06f};
    box(h, cx, 4.0f, z0 - 0.3f, w + 4.0f, 9.0f, 0.4f, velvet);
    for (float fx = x0 - 1.5f; fx < x1 + 2.0f; fx += 1.2f)
        h.add(STRATA_PRIMITIVE_CYLINDER, fx, 4.0f, z0 - 0.05f, 0.5f, 4.5f, 0.25f, scale(velvet, 1.15f));
    box(h, x0 - 1.0f, 4.0f, z1 - 1.0f, 1.2f, 9.0f, 2.5f, velvet);
    box(h, x1 + 1.0f, 4.0f, z1 - 1.0f, 1.2f, 9.0f, 2.5f, velvet);
}

inline void drawFootlights(Host& h, float x0, float x1, float z1) {
    for (float fx = x0 + 0.8f; fx < x1; fx += 1.6f) {
        ball(h, fx, 0.08f, z1 - 0.25f, 0.16f, 0.12f, 0.16f, {1.0f, 0.85f, 0.55f});
        h.point(fx, 0.12f, z1 - 0.25f, 14.0f, 0.4f, {1.0f, 0.8f, 0.5f}, 0.35f);
    }
}

// Six rows of red seats in front of the stage, an aisle down the middle and
// a gap in the front row where the owner's seat goes.
inline void drawHouse(Host& h, float x0, float x1, float z1, float ownerX) {
    const float cx = (x0 + x1) * 0.5f, w = x1 - x0;
    const Rgb seat{0.42f, 0.06f, 0.08f}, floor{0.10f, 0.05f, 0.05f};
    box(h, cx, -1.3f, z1 + 8.0f, w + 6.0f, 0.2f, 16.0f, floor);
    for (int row = 0; row < 6; ++row) {
        const float sz = z1 + 3.0f + row * 1.7f, sy = -1.2f + row * 0.35f;
        box(h, cx, sy - 0.1f, sz + 0.2f, w + 6.0f, 0.2f + row * 0.7f, 1.7f, floor);
        for (float sx = x0 - 2.0f; sx < x1 + 2.0f; sx += 1.0f) {
            if (std::fabs(sx - ownerX) < 0.5f && row == 0) continue;
            if (std::fabs(sx - cx) < 0.9f && row > 0) continue;  // the aisle
            box(h, sx, sy + 0.25f, sz, 0.8f, 0.12f, 0.7f, seat);
            box(h, sx, sy + 0.55f, sz + 0.35f, 0.8f, 0.7f, 0.1f, scale(seat, 0.8f));
        }
    }
}

// The owner's seat: gold, and it glows while anyone waits on them.
inline void drawOwnerSeat(Host& h, const Stage& s, float t) {
    const float ox = s.ownerX, oz = s.ownerZ, oy = -1.2f, wait = s.anyWaiting;
    const float p = pulse(t, 0.9f);
    const Rgb gold = mix({0.55f, 0.42f, 0.15f}, kGold, wait * p);
    box(h, ox, oy + 0.28f, oz, 0.95f, 0.16f, 0.85f, gold);
    box(h, ox, oy + 0.65f, oz + 0.4f, 0.95f, 0.9f, 0.12f, gold);
    if (wait <= 0.01f) return;
    h.point(ox, oy + 1.2f, oz, 40.0f + 30.0f * p, 1.0f, {1.0f, 0.85f, 0.35f}, (0.3f + 0.4f * p) * wait);
    ring(h, ox, oy + 0.42f, oz, 0.9f + 0.2f * p, kGold, 3.0f, wait);
    h.light(ox, oy + 2.0f, oz, 5.0f, {1.0f, 0.85f, 0.5f}, 2.0f * wait, 9);
}

// House lights: a warm fill that becomes ambient on the lowest tier.
inline void houseLights(Host& h, float x0, float z0, float x1, float z1) {
    StrataPointLight l{};
    l.range = std::max(x1 - x0, z1 - z0) * 0.9f;
    l.intensity = 0.9f;
    l.color[0] = 1.0f;
    l.color[1] = 0.85f;
    l.color[2] = 0.65f;
    l.position[0] = (x0 + x1) * 0.5f;
    l.position[1] = 7.0f;
    l.position[2] = z1 + 1.0f;
    h.fill(l, {0.10f, 0.08f, 0.06f}, 2);
}

inline void drawHall(Host& h, const Stage& s, float t) {
    const float x0 = s.x0 - 4.0f, x1 = s.x1 + 4.0f, z0 = s.z0 - 4.0f, z1 = s.z1 + 3.0f;
    drawStageFloor(h, x0, z0, x1, z1);
    drawCurtains(h, x0, z0, x1, z1);
    drawFootlights(h, x0, x1, z1);
    drawHouse(h, x0, x1, z1, s.ownerX);
    drawOwnerSeat(h, s, t);
    houseLights(h, x0, z0, x1, z1);
}

// An ensemble's rug (zone extras: riser height, anyone waiting, anyone busy).
// With someone waiting its edge pulses gold.
inline void drawRug(Host& h, const agentviz::Zone& z, float t) {
    const float y = z.extra[0], cx = (z.x0 + z.x1) * 0.5f, cz = (z.z0 + z.z1) * 0.5f;
    const float w = (z.x1 - z.x0) * z.appear, d = (z.z1 - z.z0) * z.appear;
    if (y > 0.01f) box(h, cx, y * 0.5f, cz, w, y, d, {0.22f, 0.13f, 0.07f});
    box(h, cx, y + 0.005f, cz, w - 0.2f, 0.01f, d - 0.2f, hue(z.seed, 0.45f, 0.42f));
    if (z.extra[1] < 0.5f) return;
    const float a = 0.4f + 0.6f * pulse(t, 0.9f), ey = y + 0.03f;
    const float x0 = cx - w * 0.5f, x1 = cx + w * 0.5f, z0 = cz - d * 0.5f, z1 = cz + d * 0.5f;
    wide(h, x0, ey, z1, x1, ey, z1, kGold, 3.0f, 0.0f, a);
    wide(h, x0, ey, z0, x0, ey, z1, kGold, 3.0f, 0.0f, a);
    wide(h, x1, ey, z0, x1, ey, z1, kGold, 3.0f, 0.0f, a);
    wide(h, x0, ey, z0, x1, ey, z0, kGold, 3.0f, 0.0f, a);
}

// Links: a faint thread from each musician's stand to its podium, and the
// dots that walk from a waiting conductor out to the owner's seat.
inline void drawLink(Host& h, const agentviz::Link& l, float t) {
    if (l.kind == kThread) {
        wide(h, l.x0, l.y0, l.z0, l.x1, l.y1, l.z1, hue(l.seed, 0.55f, 0.75f), 1.5f, 0.0f, l.alpha);
        return;
    }
    for (int k = 0; k < 12; ++k) {
        const float f = std::fmod(k / 12.0f + t * 0.25f, 1.0f), arc = std::sin(f * kPi);
        h.point(l.x0 + (l.x1 - l.x0) * f, l.y0 + (l.y1 - l.y0) * f + arc * 1.2f, l.z0 + (l.z1 - l.z0) * f, 12.0f,
                0.18f, {1.0f, 0.85f, 0.35f}, 0.8f * l.alpha * arc);
    }
}

}  // namespace orchestra
