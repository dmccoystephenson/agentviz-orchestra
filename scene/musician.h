// musician.h: a subagent. A musician on a chair in its conductor's colour,
// facing the podium across a music stand that names its lane (the label is
// the page's), playing the instrument of what it is doing.
#pragma once

#include "instruments.h"

namespace orchestra {

inline void musicianBody(Host& h, const agentviz::Agent& a, const Pose& p, Rgb accent, bool active, float t) {
    chair(h, p.x, p.y, p.z, p.dx, p.dz, scale(accent, 0.55f));
    box(h, p.x, p.y + 0.49f, p.z, 0.4f, 0.03f, 0.4f, accent);
    const float bright = active ? 1.0f : 0.75f;
    h.add(STRATA_PRIMITIVE_CAPSULE, p.x, p.y + 0.8f, p.z, 0.42f, 0.3f, 0.42f, scale({0.08f, 0.08f, 0.1f}, bright));
    const float nod = active ? 0.03f * std::sin(t * 3.0f + a.seed * 11.0f) : -0.04f;
    const float hx = p.x + p.dx * 0.02f, hz = p.z + p.dz * 0.02f, hy = p.y + 1.2f + nod;
    ball(h, hx, hy, hz, 0.3f, 0.32f, 0.3f, scale({0.85f, 0.66f, 0.52f}, bright));
    ball(h, hx - p.dx * 0.05f, hy + 0.07f, hz - p.dz * 0.05f, 0.29f, 0.2f, 0.29f, hue(a.seed + 0.5f, 0.4f, 0.4f));
    ball(h, hx + p.dx * 0.15f, hy - 0.01f, hz + p.dz * 0.15f, 0.06f, 0.06f, 0.06f, {0.8f, 0.6f, 0.5f});
}

inline void drawMusician(Host& h, const agentviz::Agent& a, float t) {
    const Pose p = poseOf(a);
    const Rgb accent = hue(a.parentSeed, 0.55f, 0.75f);  // the conductor's colour
    const float up = a.state == State::Busy ? a.extra[kUp] : 0.0f;
    const bool active = up > 0.5f;
    musicianBody(h, a, p, accent, active, t);

    const Player player{p.x, p.y + 0.8f, p.z, p.dx, p.dz, p.px, p.pz, p.y, a.seed * 13.0f};
    const Sound sound = instrument(h, a.action, player, up, t);
    if (active && a.action != Action::Think) notes(h, sound, family(a.action), t, a.seed, 3, 0.85f);
    if (active && a.action == Action::Think)
        h.point(p.x, p.y + 1.6f + 0.05f * std::sin(t * 1.3f), p.z, 10.0f, 0.14f, family(Action::Think), 0.8f);
    callNote(h, sound, a.action == Action::None ? kPaleGold : family(a.action), a.pulse);

    // The stand, between the musician and its conductor.
    const float vx = a.extra[kLeadX] - p.x, vz = a.extra[kLeadZ] - p.z;
    const float len = std::max(std::sqrt(vx * vx + vz * vz), 0.01f);
    musicStand(h, p.x + vx / len * 0.85f, p.y, p.z + vz / len * 0.85f, vx / len, vz / len, a.action, active,
               a.toolCount, a.pulse);
    if (a.stalled) {  // quiet too long without finishing: the chair flashes red under a wrong note
        disc(h, p.x, p.y + 0.012f, p.z, 1.4f, 0.01f, scale(kRed, 0.2f + 0.4f * stallFlash(t)));
        wrongNote(h, p.x, p.y + 1.75f, p.z, t, 0.8f);
    }
    highlightRing(h, a.highlight, p.x, p.y, p.z, 0.7f, t);
}

}  // namespace orchestra
