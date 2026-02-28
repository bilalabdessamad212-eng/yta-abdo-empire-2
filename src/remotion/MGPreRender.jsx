import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import { MotionGraphic } from './MotionGraphics';

// Full-screen MG background gradients per style (same as Composition.jsx)
const MG_BACKGROUNDS = {
    clean:    'radial-gradient(ellipse at center, #0a0a2e, #000000)',
    bold:     'radial-gradient(ellipse at center, #1a0000, #0a0a0a)',
    minimal:  'radial-gradient(ellipse at center, #1a1a2e, #0f0f0f)',
    neon:     'radial-gradient(ellipse at center, #000020, #000008)',
    cinematic:'radial-gradient(ellipse at center, #1a1500, #000000)',
    elegant:  'radial-gradient(ellipse at center, #0a0020, #050010)',
};

/**
 * Pre-render a single MG as a transparent or styled clip.
 *
 * inputProps shape:
 *   { mg: { type, text, subtext, style, position, duration, ... },
 *     scriptContext: { themeId, ... },
 *     duration: number (seconds),
 *     isFullScreen: boolean }
 */
export const MGPreRenderComposition = (props) => {
    const { mg, scriptContext, isFullScreen } = props;

    if (!mg) {
        return <AbsoluteFill style={{ backgroundColor: 'transparent' }} />;
    }

    // Full-screen MG scenes get an opaque background
    if (isFullScreen) {
        const bgStyle = MG_BACKGROUNDS[mg.style] || MG_BACKGROUNDS.clean;

        // mapChart renders its own full-frame background
        if (mg.type === 'mapChart') {
            return (
                <AbsoluteFill>
                    <MotionGraphic mg={mg} scriptContext={scriptContext || {}} />
                </AbsoluteFill>
            );
        }

        // articleHighlight has 3D transforms — no scale(1.5)
        if (mg.type === 'articleHighlight') {
            return (
                <AbsoluteFill style={{ background: bgStyle }}>
                    <MotionGraphic mg={mg} scriptContext={scriptContext || {}} />
                </AbsoluteFill>
            );
        }

        // Default full-screen MG: background + scale(1.5)
        return (
            <AbsoluteFill style={{ background: bgStyle }}>
                <AbsoluteFill style={{ transform: 'scale(1.5)', transformOrigin: 'center center' }}>
                    <MotionGraphic mg={mg} scriptContext={scriptContext || {}} />
                </AbsoluteFill>
            </AbsoluteFill>
        );
    }

    // Overlay MG: transparent background — rendered over video in FFmpeg
    return (
        <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
            <MotionGraphic mg={mg} scriptContext={scriptContext || {}} />
        </AbsoluteFill>
    );
};

/**
 * Batch render ALL MGs in a single video, back-to-back.
 * Each MG gets its own Sequence with local frame numbering so animations work.
 *
 * inputProps shape:
 *   { items: [{ mg, isFullScreen, offsetFrames, durationFrames }],
 *     scriptContext: { themeId, ... },
 *     totalDuration: number (seconds) }
 */
export const MGBatchComposition = (props) => {
    const { items, scriptContext } = props;

    if (!items || items.length === 0) {
        return <AbsoluteFill style={{ backgroundColor: 'transparent' }} />;
    }

    return (
        <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
            {items.map((item, i) => (
                <Sequence
                    key={i}
                    from={item.offsetFrames}
                    durationInFrames={item.durationFrames}
                    layout="none"
                >
                    <RenderSingleMG
                        mg={item.mg}
                        scriptContext={scriptContext || {}}
                        isFullScreen={item.isFullScreen}
                    />
                </Sequence>
            ))}
        </AbsoluteFill>
    );
};

// Internal: render a single MG (used by both single and batch compositions)
const RenderSingleMG = ({ mg, scriptContext, isFullScreen }) => {
    if (!mg) return null;

    if (isFullScreen) {
        const bgStyle = MG_BACKGROUNDS[mg.style] || MG_BACKGROUNDS.clean;

        if (mg.type === 'mapChart') {
            return (
                <AbsoluteFill>
                    <MotionGraphic mg={mg} scriptContext={scriptContext} />
                </AbsoluteFill>
            );
        }
        if (mg.type === 'articleHighlight') {
            return (
                <AbsoluteFill style={{ background: bgStyle }}>
                    <MotionGraphic mg={mg} scriptContext={scriptContext} />
                </AbsoluteFill>
            );
        }
        return (
            <AbsoluteFill style={{ background: bgStyle }}>
                <AbsoluteFill style={{ transform: 'scale(1.5)', transformOrigin: 'center center' }}>
                    <MotionGraphic mg={mg} scriptContext={scriptContext} />
                </AbsoluteFill>
            </AbsoluteFill>
        );
    }

    return (
        <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
            <MotionGraphic mg={mg} scriptContext={scriptContext} />
        </AbsoluteFill>
    );
};
