// agentviz-orchestra: Claude Code sessions as a concert stage.
//
// The page (web/orchestra-*.js) owns the data and the layout: it reads the
// agent feed, places every ensemble (one per repo), conductor (session) and
// musician (subagent) on the stage and eases them between snapshots. Every
// frame it packs the stage in the agentviz wire format (vendor/agentviz-kit,
// docs/KIT.md in the agentviz repo) and calls agentviz_frame(); this file
// only draws what the frame says:
//   scene floats  the occupied stage, the owner's seat, anyone waiting (hall.h)
//   zones         ensemble rugs, one per place (hall.h)
//   agents        conductors or empty chairs (conductor.h), musicians (musician.h)
//   links         stand-to-podium threads, waiting trails to the owner's seat (hall.h)
#define STRATA_KIT_MAIN
#include "strata_kit.h"

#include "conductor.h"
#include "hall.h"
#include "musician.h"

namespace {

agentviz::Frame frame;

}  // namespace

AGENTVIZ_FRAME_EXPORT(frame)

void strata_kit_configure(strata_kit::Options& o) {
    o.name = "agentviz-orchestra";
    o.fog = false;
}

void strata_kit_engine_ready(strata_kit::Host&) {}

void strata_kit_build(strata_kit::Host& h, double seconds) {
    // An indoor hall: a dark house, a low warm key light and the spots.
    h.clearFlags = STRATA_CLEAR_COLOR | STRATA_CLEAR_DEPTH;
    h.clearColor[0] = 0.025f;
    h.clearColor[1] = 0.018f;
    h.clearColor[2] = 0.03f;
    h.clearColor[3] = 1.0f;
    h.sunIntensity = 0.55f;
    h.sunTint = {1.0f, 0.88f, 0.72f};
    h.ambientTint = {0.75f, 0.68f, 0.72f};
    if (!frame.ok) return;

    const float t = static_cast<float>(seconds);
    orchestra::drawHall(h, orchestra::stageOf(frame), t);
    for (const auto& zone : frame.zones) orchestra::drawRug(h, zone, t);
    for (const auto& agent : frame.agents) {
        if (!agent.lead()) orchestra::drawMusician(h, agent, t);
        else if (agent.state == agentviz::State::Offline) orchestra::drawEmptyChair(h, agent, t);
        else orchestra::drawConductor(h, agent, t);
    }
    for (const auto& link : frame.links) orchestra::drawLink(h, link, t);
}
