// conductor.h: a session. A conductor on a podium under a spotlight; when it
// needs you it turns to the owner's seat with a sign of why (a "?" for a
// question, a padlock for a permission prompt) and the solo chair beside it
// lights up. An offline session leaves an empty chair and a closed case.
#pragma once

#include "instruments.h"

namespace orchestra {

struct Hands {
    float rx, ry, rz, lx, ly, lz;
};

// Where the hands go: open to the audience, the beat pattern, the held
// pause, forward on an instrument, or down by the sides.
inline Hands conductorHands(const agentviz::Agent& a, const Pose& p, float sy, float up, float wait, float t) {
    const float rsx = p.x + p.px * 0.26f, rsz = p.z + p.pz * 0.26f, lsx = p.x - p.px * 0.26f, lsz = p.z - p.pz * 0.26f;
    const bool busy = a.state == State::Busy;
    auto at = [&](float fwd, float side, float rise, float lfwd, float lside, float lrise) {
        return Hands{rsx + p.dx * fwd + p.px * side, sy + rise, rsz + p.dz * fwd + p.pz * side,
                     lsx + p.dx * lfwd - p.px * lside, sy + lrise, lsz + p.dz * lfwd - p.pz * lside};
    };
    if (wait > 0.5f) {
        const float o = 0.35f + 0.06f * pulse(t, 0.5f);
        return at(0.25f, o, 0.15f, 0.25f, o, 0.15f);
    }
    if (busy && a.action == Action::Delegate) {
        const float ph = t * 3.0f + a.seed * 9.0f, s = std::sin(ph), c = std::fabs(std::cos(ph));
        return at(0.4f, s * 0.3f, 0.05f + c * 0.35f, 0.35f, s * 0.1f, 0.1f + c * 0.15f);
    }
    if (busy && a.action == Action::Think) {
        const float b = 0.42f + 0.02f * std::sin(t * 1.2f);
        return at(0.3f, 0.08f, b, 0.3f, 0.08f, b);
    }
    if (busy && up > 0.5f) return at(0.32f, 0.0f, -0.18f, 0.32f, 0.0f, -0.18f);
    return at(0.0f, 0.04f, -0.5f, 0.0f, 0.04f, -0.5f);
}

inline void podium(Host& h, const agentviz::Agent& a, const Pose& p, Rgb accent, float wait, float t) {
    const bool busy = a.state == State::Busy;
    const float poolK = wait > 0.01f ? 0.8f + 0.2f * wait : (busy ? 0.75f : (a.state == State::Idle ? 0.42f : 0.25f));
    Rgb pool = mix({0.95f, 0.82f, 0.58f}, {1.0f, 0.95f, 0.7f}, wait);
    if (a.stalled) pool = mix(pool, {0.85f, 0.1f, 0.08f}, 0.85f * stallFlash(t));
    disc(h, p.x, p.y + 0.012f, p.z, 2.6f, 0.01f, scale(pool, poolK));
    box(h, p.x, p.y + 0.17f, p.z, 1.0f, 0.34f, 1.0f, {0.16f, 0.10f, 0.07f});
    box(h, p.x, p.y + 0.345f, p.z, 1.04f, 0.02f, 1.04f, scale(accent, 0.55f));
}

// Body, head, hair and a sash in the session's colour; a white bow tie and a
// small bow while it faces the audience.
inline void conductorBody(Host& h, const agentviz::Agent& a, const Pose& p, float fy, Rgb accent, float wait, float t) {
    const float bright = a.state == State::Dim ? 0.5f : 1.0f;
    const float bow = wait > 0.5f ? 0.08f * pulse(t, 0.5f) : 0.0f;
    h.add(STRATA_PRIMITIVE_CAPSULE, p.x, fy + 0.55f, p.z, 0.5f, 0.42f, 0.5f, scale(kBlackTie, bright));
    box(h, p.x + p.dx * 0.2f, fy + 0.78f, p.z + p.dz * 0.2f, 0.18f, 0.12f, 0.18f, accent);
    const float hx = p.x + p.dx * bow, hz = p.z + p.dz * bow, hy = fy + 1.18f - bow;
    ball(h, hx, hy, hz, 0.34f, 0.36f, 0.34f, scale(kSkin, bright));
    ball(h, hx - p.dx * 0.05f, hy + 0.08f, hz - p.dz * 0.05f, 0.33f, 0.24f, 0.33f, hue(a.seed + 0.37f, 0.35f, 0.35f));
    ball(h, hx + p.dx * 0.17f, hy - 0.01f, hz + p.dz * 0.17f, 0.07f, 0.07f, 0.07f, {0.8f, 0.6f, 0.5f});
    if (wait > 0.5f) box(h, p.x + p.dx * 0.25f, fy + 0.93f, p.z + p.dz * 0.25f, 0.16f, 0.07f, 0.16f, kWhite);
}

inline void arms(Host& h, const agentviz::Agent& a, const Pose& p, float sy, const Hands& hd, float wait) {
    const float bright = a.state == State::Dim ? 0.5f : 1.0f;
    const Rgb sleeve = scale({0.09f, 0.09f, 0.11f}, bright);
    wide(h, p.x + p.px * 0.26f, sy, p.z + p.pz * 0.26f, hd.rx, hd.ry, hd.rz, sleeve, 5.0f, 0.12f);
    wide(h, p.x - p.px * 0.26f, sy, p.z - p.pz * 0.26f, hd.lx, hd.ly, hd.lz, sleeve, 5.0f, 0.12f);
    ball(h, hd.rx, hd.ry, hd.rz, 0.1f, 0.1f, 0.1f, kSkin);
    ball(h, hd.lx, hd.ly, hd.lz, 0.1f, 0.1f, 0.1f, kSkin);
    const bool busy = a.state == State::Busy;
    const bool holdsBaton = a.action == Action::Delegate || a.action == Action::Think || a.action == Action::None || !busy;
    if (wait > 0.5f || !holdsBaton) return;
    const float rsx = p.x + p.px * 0.26f, rsz = p.z + p.pz * 0.26f;
    const float bx = hd.rx + (hd.rx - rsx) * 0.9f + (busy ? 0.0f : p.dx * 0.1f), bz = hd.rz + (hd.rz - rsz) * 0.9f;
    const float by = hd.ry + (busy ? 0.45f : -0.25f);
    wide(h, hd.rx, hd.ry, hd.rz, bx, by, bz, kWhite, 2.5f, 0.015f);
    if (busy && a.action == Action::Delegate) h.point(bx, by, bz, 9.0f, 0.12f, {1.0f, 1.0f, 0.9f}, 0.8f);
}

// A fermata over the head: three slow lavender dots.
inline void fermata(Host& h, const Pose& p, float fy, float t) {
    for (int k = 0; k < 3; ++k) {
        const float a = t * 0.6f + k * 2.1f;
        h.point(p.x + std::cos(a) * 0.35f, fy + 1.75f + 0.05f * std::sin(t + k), p.z + std::sin(a) * 0.35f, 10.0f, 0.16f,
                family(Action::Think), 0.85f);
    }
}

// Why it waits, in gold over the head, drawn across the conductor's facing
// so it reads the right way round from the house: "?" (a question) or a
// padlock (a permission prompt).
inline void reasonSign(Host& h, agentviz::WaitingReason why, const Pose& p, float y, float wait) {
    // The glyph's +u axis: the conductor's right hand. The orbit camera's view
    // mirrors x, so this reads the right way round from the house (checked in
    // docs/media/closeup-question.png).
    const float gx = p.px, gz = p.pz;
    auto pt = [&](float u, float v, float out[3]) { out[0] = p.x + gx * u; out[1] = y + v; out[2] = p.z + gz * u; };
    auto seg = [&](float u0, float v0, float u1, float v1) {
        float a[3], b[3];
        pt(u0, v0, a);
        pt(u1, v1, b);
        wide(h, a[0], a[1], a[2], b[0], b[1], b[2], kGold, 5.0f, 0.06f, wait);
    };
    if (why == agentviz::WaitingReason::Permission) {  // padlock: shackle arc over a body
        for (int k = 0; k < 8; ++k) {
            const float a0 = kPi * k / 8, a1 = kPi * (k + 1) / 8;
            seg(std::cos(a0) * 0.14f, 0.1f + std::sin(a0) * 0.16f, std::cos(a1) * 0.14f, 0.1f + std::sin(a1) * 0.16f);
        }
        float c[3];
        pt(0.0f, -0.06f, c);
        box(h, c[0], c[1], c[2], std::fabs(gx) * 0.36f + 0.06f, 0.3f, std::fabs(gz) * 0.36f + 0.06f, kGold);
        return;
    }
    if (why != agentviz::WaitingReason::Question) return;
    float u = -0.15f, v = 0.22f;  // the hook of the "?": from its left, over the top, round and down
    for (int k = 1; k <= 6; ++k) {
        const float a = kPi * (1.0f - k * 0.25f), nu = std::cos(a) * 0.15f, nv = 0.22f + std::sin(a) * 0.15f;
        seg(u, v, nu, nv);
        u = nu;
        v = nv;
    }
    seg(u, v, 0.0f, 0.07f);
    seg(0.0f, 0.07f, 0.0f, -0.06f);
    float d[3];
    pt(0.0f, -0.2f, d);
    ball(h, d[0], d[1], d[2], 0.09f, 0.09f, 0.09f, kGold);
}

// The solo chair under a bright spotlight, pulsing rings round podium and
// chair, a beacon over the head.
inline void waitingSpotlight(Host& h, const agentviz::Agent& a, const Pose& p, float fy, float wait, float t) {
    const float cx = a.extra[kSoloX], cz = a.extra[kSoloZ], k = pulse(t, 0.9f);
    disc(h, cx, p.y + 0.016f, cz, 1.9f, 0.012f, scale(kPaleGold, 0.6f + 0.4f * wait));
    chair(h, cx, p.y, cz, -p.dx, -p.dz, scale({0.95f, 0.75f, 0.25f}, 0.6f + 0.4f * wait));
    for (int i = 0; i < 14; ++i) {
        const float f = i / 13.0f;
        h.point(cx, p.y + 0.3f + f * 7.0f, cz, 50.0f + 40.0f * f, 0.6f + f * 1.4f, kPaleGold, (0.16f - f * 0.08f) * wait);
    }
    h.light(cx, p.y + 3.0f, cz, 7.0f, {1.0f, 0.95f, 0.8f}, (2.5f + 1.0f * k) * wait, 10);
    ring(h, p.x, p.y + 0.05f, p.z, 1.4f + 0.25f * k, {1.0f, 0.85f, 0.3f}, 4.0f, (0.5f + 0.5f * k) * wait);
    ring(h, cx, p.y + 0.05f, cz, 1.0f + 0.15f * (1.0f - k), {1.0f, 0.95f, 0.7f}, 3.0f, 0.8f * wait);
    h.point(p.x, fy + 2.2f, p.z, 40.0f + 25.0f * k, 0.9f, {1.0f, 0.82f, 0.3f}, (0.45f + 0.35f * k) * wait);
    reasonSign(h, a.waitingReason, p, fy + 2.75f, wait);
}

inline void drawConductor(Host& h, const agentviz::Agent& a, float t) {
    const Pose p = poseOf(a);
    const float up = a.extra[kUp], wait = a.extra[kWait], fy = p.y + 0.35f, sy = fy + 0.88f;
    const Rgb accent = hue(a.seed, 0.65f, 0.9f);
    const bool busy = a.state == State::Busy;
    podium(h, a, p, accent, wait, t);
    conductorBody(h, a, p, fy, accent, wait, t);
    arms(h, a, p, sy, conductorHands(a, p, sy, up, wait, t), wait);
    const bool plays = wait <= 0.5f && busy && a.action != Action::Delegate && a.action != Action::Think;
    const Player player{p.x, fy + 0.55f, p.z, p.dx, p.dz, p.px, p.pz, fy, a.seed * 13.0f};
    const Sound sound = plays ? instrument(h, a.action, player, up, t) : Sound{p.x, fy + 1.5f, p.z};
    if (plays) notes(h, sound, family(a.action), t, a.seed, 3, 0.9f);
    callNote(h, sound, a.action == Action::None ? kPaleGold : family(a.action), a.pulse);
    if (busy && a.action == Action::Think && wait <= 0.5f) fermata(h, p, fy, t);
    if (busy && wait < 0.5f) h.light(p.x + p.dx * 0.3f, fy + 3.2f, p.z + p.dz * 0.3f, 6.0f, {1.0f, 0.86f, 0.62f}, 1.4f, 3);
    if (wait > 0.01f) waitingSpotlight(h, a, p, fy, wait, t);
    if (a.stalled) wrongNote(h, p.x, fy + 1.85f, p.z, t);
    highlightRing(h, a.highlight, p.x, p.y, p.z, 1.5f, t);
}

// Offline: an empty chair, a closed instrument case and a bare podium.
inline void drawEmptyChair(Host& h, const agentviz::Agent& a, float t) {
    const Pose p = poseOf(a);
    chair(h, p.x, p.y, p.z, p.dx, p.dz, {0.22f, 0.18f, 0.16f});
    const bool sideways = std::fabs(p.px) > 0.5f;
    const float cx = p.x + p.px * 0.6f, cz = p.z + p.pz * 0.6f;
    box(h, cx, p.y + 0.13f, cz, sideways ? 0.3f : 0.95f, 0.24f, sideways ? 0.95f : 0.3f, {0.17f, 0.11f, 0.08f});
    box(h, cx, p.y + 0.27f, cz, 0.12f, 0.04f, 0.12f, {0.5f, 0.45f, 0.35f});
    box(h, p.x, p.y + 0.17f, p.z + p.dz * 0.7f, 0.8f, 0.34f, 0.8f, {0.11f, 0.08f, 0.06f});
    highlightRing(h, a.highlight, p.x, p.y, p.z, 1.0f, t);
}

}  // namespace orchestra
