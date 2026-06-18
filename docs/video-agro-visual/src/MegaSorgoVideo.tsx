import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Clip = {
  src: string;
  trimStart: number;
  title: string;
  kicker: string;
  note: string;
  rotate?: boolean;
};

const clips: Clip[] = [
  {
    src: "mega-sorgo/mega-05.mp4",
    trimStart: 0.4,
    kicker: "campo real",
    title: "MEGA SORGO",
    note: "porte alto para volumoso",
  },
  {
    src: "mega-sorgo/mega-01.mp4",
    trimStart: 1.2,
    kicker: "colheita",
    title: "CORTE EM ÁREA REAL",
    note: "massa verde indo direto para o vagão",
  },
  {
    src: "mega-sorgo/mega-03.mp4",
    trimStart: 1.0,
    kicker: "silagem",
    title: "VOLUME PARA O SILO",
    note: "forragem picada para reserva alimentar",
  },
  {
    src: "mega-sorgo/mega-04.mp4",
    trimStart: 0.6,
    kicker: "pecuária",
    title: "NO COCHO",
    note: "o resultado aparece no consumo do rebanho",
  },
  {
    src: "mega-sorgo/mega-02.mp4",
    trimStart: 3.5,
    kicker: "operação",
    title: "PLANTIO QUE VIRA ALIMENTO",
    note: "sorgo, silagem e custo alimentar na mesma conta",
    rotate: true,
  },
];

const colors = {
  green: "#173A25",
  green2: "#2F6B3C",
  yellow: "#E0A51B",
  cream: "#F7F0DC",
  black: "#101610",
  red: "#C7352B",
};

const ease = (frame: number, input: [number, number], output: [number, number]) =>
  interpolate(frame, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const VideoFill: React.FC<{ clip: Clip }> = ({ clip }) => {
  const { fps } = useVideoConfig();
  const baseStyle: React.CSSProperties = {
    position: "absolute",
  };

  if (clip.rotate) {
    return (
      <Video
        src={staticFile(clip.src)}
        trimBefore={clip.trimStart * fps}
        volume={0.18}
        objectFit="cover"
        style={{
          ...baseStyle,
          width: 1920,
          height: 1080,
          left: -420,
          top: 420,
          transform: "rotate(-90deg) scale(1.04)",
          transformOrigin: "center center",
        }}
      />
    );
  }

  return (
    <Video
      src={staticFile(clip.src)}
      trimBefore={clip.trimStart * fps}
      volume={0.18}
      objectFit="cover"
      style={{
        ...baseStyle,
        inset: 0,
        width: "100%",
        height: "100%",
      }}
    />
  );
};

const OverlayText: React.FC<{ clip: Clip; index: number }> = ({ clip, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const y = ease(frame, [0.1 * fps, 0.8 * fps], [70, 0]);
  const opacity = ease(frame, [0.1 * fps, 0.6 * fps], [0, 1]);
  const bar = ease(frame, [0.2 * fps, 1.0 * fps], [0, 1]);

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(10,20,12,0.55) 0%, rgba(10,20,12,0.06) 42%, rgba(10,20,12,0.82) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 104,
          left: 64,
          right: 64,
          transform: `translateY(${y}px)`,
          opacity,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 18,
            padding: "16px 24px",
            borderRadius: 999,
            background: index === 3 ? colors.red : colors.yellow,
            color: index === 3 ? colors.cream : colors.black,
            fontSize: 34,
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: 0,
          }}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span>{clip.kicker}</span>
        </div>
        <div
          style={{
            marginTop: 34,
            maxWidth: 920,
            color: colors.cream,
            fontSize: clip.title.length > 22 ? 76 : clip.title.length > 14 ? 88 : 116,
            lineHeight: 0.94,
            fontWeight: 950,
            letterSpacing: 0,
            textShadow: "0 18px 60px rgba(0,0,0,0.55)",
          }}
        >
          {clip.title}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 80,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            width: `${bar * 100}%`,
            height: 8,
            borderRadius: 999,
            background: colors.yellow,
            marginBottom: 24,
          }}
        />
        <div
          style={{
            padding: "28px 32px",
            borderRadius: 28,
            background: "rgba(247,240,220,0.94)",
            color: colors.green,
            fontSize: 38,
            lineHeight: 1.12,
            fontWeight: 850,
            boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
          }}
        >
          {clip.note}
        </div>
      </div>
    </>
  );
};

const ClipScene: React.FC<{ clip: Clip; index: number }> = ({ clip, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = ease(frame, [0, 6 * fps], [1.03, 1.12]);

  return (
    <AbsoluteFill style={{ background: colors.black, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${zoom})`,
        }}
      >
        <VideoFill clip={clip} />
      </div>
      <OverlayText clip={clip} index={index} />
    </AbsoluteFill>
  );
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = ease(frame, [0, 0.6 * fps], [0, 1]);
  const y = ease(frame, [0, 0.9 * fps], [80, 0]);

  return (
    <AbsoluteFill style={{ background: colors.green, overflow: "hidden" }}>
      <Video
        src={staticFile("mega-sorgo/mega-05.mp4")}
        trimBefore={0.2 * fps}
        volume={0.1}
        objectFit="cover"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.62,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(160deg, rgba(12,30,19,0.85) 0%, rgba(12,30,19,0.54) 55%, rgba(224,165,27,0.34) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 210,
          transform: `translateY(${y}px)`,
          opacity,
          fontFamily: "Arial, Helvetica, sans-serif",
          color: colors.cream,
        }}
      >
        <div
          style={{
            fontSize: 38,
            fontWeight: 900,
            color: colors.yellow,
            textTransform: "uppercase",
          }}
        >
          Mega Sorgo Santa Elisa
        </div>
        <div
          style={{
            marginTop: 38,
            fontSize: 112,
            lineHeight: 0.94,
            fontWeight: 950,
            textShadow: "0 20px 70px rgba(0,0,0,0.58)",
          }}
        >
          vídeo base para campanha visual
        </div>
        <div
          style={{
            marginTop: 46,
            maxWidth: 880,
            fontSize: 42,
            lineHeight: 1.16,
            fontWeight: 760,
          }}
        >
          Do campo ao cocho: mostrar volume, colheita e uso na pecuária.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = ease(frame, [0, 0.6 * fps], [0, 1]);

  return (
    <AbsoluteFill style={{ background: colors.green, overflow: "hidden" }}>
      <Video
        src={staticFile("mega-sorgo/mega-04.mp4")}
        trimBefore={1.2 * fps}
        volume={0.12}
        objectFit="cover"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.48,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(13,39,25,0.74)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 210,
          opacity,
          fontFamily: "Arial, Helvetica, sans-serif",
          color: colors.cream,
        }}
      >
        <div
          style={{
            fontSize: 92,
            lineHeight: 0.98,
            fontWeight: 950,
          }}
        >
          Linha criativa:
        </div>
        {[
          "porte e volume no campo",
          "colheita virando silagem",
          "rebanho consumindo no cocho",
        ].map((item, index) => (
          <div
            key={item}
            style={{
              marginTop: 44,
              display: "flex",
              alignItems: "center",
              gap: 28,
              fontSize: 44,
              lineHeight: 1.1,
              fontWeight: 850,
            }}
          >
            <div
              style={{
                width: 66,
                height: 66,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: colors.yellow,
                color: colors.black,
                flex: "0 0 auto",
              }}
            >
              {index + 1}
            </div>
            {item}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 88,
          padding: "30px 34px",
          borderRadius: 30,
          background: colors.cream,
          color: colors.green,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 42,
          lineHeight: 1.12,
          fontWeight: 900,
        }}
      >
        Chamada: planeje volumoso para pecuária de leite e corte.
      </div>
    </AbsoluteFill>
  );
};

export const MegaSorgoExamples: React.FC = () => {
  return (
    <Series>
      <Series.Sequence durationInFrames={105}>
        <Intro />
      </Series.Sequence>
      {clips.map((clip, index) => (
        <Series.Sequence key={clip.src} durationInFrames={150}>
          <ClipScene clip={clip} index={index} />
        </Series.Sequence>
      ))}
      <Series.Sequence durationInFrames={135}>
        <Outro />
      </Series.Sequence>
    </Series>
  );
};

const viralCuts: Clip[] = [
  {
    src: "mega-sorgo/mega-05.mp4",
    trimStart: 0.3,
    kicker: "gancho",
    title: "OLHA O TAMANHO DISSO",
    note: "volumoso começa no campo",
  },
  {
    src: "mega-sorgo/mega-01.mp4",
    trimStart: 1.0,
    kicker: "corte",
    title: "VIRA SILAGEM",
    note: "massa verde para reserva alimentar",
  },
  {
    src: "mega-sorgo/mega-03.mp4",
    trimStart: 1.0,
    kicker: "volume",
    title: "ENCHENDO O VAGÃO",
    note: "quando tem planta, tem comida",
  },
  {
    src: "mega-sorgo/mega-04.mp4",
    trimStart: 0.8,
    kicker: "prova",
    title: "CHEGA NO COCHO",
    note: "pecuária sente na dieta",
  },
  {
    src: "mega-sorgo/mega-02.mp4",
    trimStart: 3.6,
    kicker: "conta",
    title: "MENOS RISCO NA SECA",
    note: "sorgo entra como estratégia alimentar",
    rotate: true,
  },
];

const HookIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const punch = ease(frame, [0, 0.45 * fps], [1.18, 1]);
  const opacity = ease(frame, [0, 0.35 * fps], [0, 1]);

  return (
    <AbsoluteFill style={{ background: colors.black, overflow: "hidden" }}>
      <Video
        src={staticFile("mega-sorgo/mega-05.mp4")}
        trimBefore={0.1 * fps}
        volume={0}
        objectFit="cover"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          transform: `scale(${punch})`,
          opacity: 0.72,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.58), rgba(0,0,0,0.2), rgba(0,0,0,0.86))",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 54,
          right: 54,
          top: 150,
          opacity,
          fontFamily: "Arial, Helvetica, sans-serif",
          color: colors.cream,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            background: colors.red,
            color: colors.cream,
            borderRadius: 999,
            padding: "18px 26px",
            fontSize: 38,
            fontWeight: 950,
            textTransform: "uppercase",
          }}
        >
          pare 3 segundos
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 124,
            lineHeight: 0.9,
            fontWeight: 950,
            textShadow: "0 18px 58px rgba(0,0,0,0.65)",
          }}
        >
          ISSO VIRA COMIDA NO COCHO
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ViralClipScene: React.FC<{ clip: Clip; index: number }> = ({
  clip,
  index,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flash = interpolate(frame, [0, 5, 12], [0.4, 0.0, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.black, overflow: "hidden" }}>
      <ClipScene clip={clip} index={index} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: colors.yellow,
          opacity: flash,
          mixBlendMode: "screen",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 46,
          top: 46,
          width: 92,
          height: 92,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          background: "rgba(16,22,16,0.72)",
          color: colors.yellow,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 34,
          fontWeight: 950,
          border: `4px solid ${colors.yellow}`,
        }}
      >
        {index + 1}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 14,
          background: colors.yellow,
          transform: `scaleX(${ease(frame, [0, 3.5 * fps], [0, 1])})`,
          transformOrigin: "left center",
        }}
      />
    </AbsoluteFill>
  );
};

const ViralOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const y = ease(frame, [0, 0.6 * fps], [60, 0]);

  return (
    <AbsoluteFill style={{ background: colors.green, overflow: "hidden" }}>
      <Video
        src={staticFile("mega-sorgo/mega-04.mp4")}
        trimBefore={1.0 * fps}
        volume={0}
        objectFit="cover"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.48,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(12,34,22,0.78)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 58,
          right: 58,
          top: 180,
          transform: `translateY(${y}px)`,
          fontFamily: "Arial, Helvetica, sans-serif",
          color: colors.cream,
        }}
      >
        <div style={{ color: colors.yellow, fontSize: 42, fontWeight: 950 }}>
          MEGA SORGO SANTA ELISA
        </div>
        <div
          style={{
            marginTop: 36,
            fontSize: 108,
            lineHeight: 0.92,
            fontWeight: 950,
          }}
        >
          PLANEJE VOLUMOSO ANTES DA SECA
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 58,
          right: 58,
          bottom: 86,
          borderRadius: 30,
          padding: "32px 34px",
          background: colors.cream,
          color: colors.green,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 42,
          lineHeight: 1.12,
          fontWeight: 950,
        }}
      >
        Comente sua região e monte a conta da safra.
      </div>
    </AbsoluteFill>
  );
};

export const MegaSorgoViralHook: React.FC = () => {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("audio/viral-agro-pulse.wav")} volume={0.72} />
      <Series>
        <Series.Sequence durationInFrames={75}>
          <HookIntro />
        </Series.Sequence>
        {viralCuts.map((clip, index) => (
          <Series.Sequence key={clip.src} durationInFrames={105}>
            <ViralClipScene clip={clip} index={index} />
          </Series.Sequence>
        ))}
        <Series.Sequence durationInFrames={120}>
          <ViralOutro />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

const socialCuts: Clip[] = [
  {
    src: "mega-sorgo/mega-05.mp4",
    trimStart: 0.2,
    kicker: "1",
    title: "PROMESSA CLARA",
    note: "mais volumoso para defender o leite na seca",
  },
  {
    src: "mega-sorgo/mega-01.mp4",
    trimStart: 1.0,
    kicker: "2",
    title: "MECANISMO",
    note: "planta, ensila e transforma area em reserva",
  },
  {
    src: "mega-sorgo/mega-04.mp4",
    trimStart: 0.5,
    kicker: "3",
    title: "DOR CARA",
    note: "menos pressa para comprar racao quando o pasto cai",
  },
  {
    src: "mega-sorgo/mega-03.mp4",
    trimStart: 1.2,
    kicker: "4",
    title: "PROVA VISUAL",
    note: "massa no campo e alimento chegando no cocho",
  },
];

const SafeFrame: React.FC = () => (
  <>
    <div
      style={{
        position: "absolute",
        left: 34,
        right: 34,
        top: 34,
        bottom: 210,
        border: "2px solid rgba(247,240,220,0.14)",
        borderRadius: 34,
        pointerEvents: "none",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 52,
        right: 52,
        bottom: 34,
        height: 148,
        borderRadius: 28,
        border: "2px dashed rgba(224,165,27,0.35)",
        pointerEvents: "none",
      }}
    />
  </>
);

const SocialClipScene: React.FC<{ clip: Clip; index: number }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleY = ease(frame, [0, 0.55 * fps], [62, 0]);
  const titleOpacity = ease(frame, [0, 0.38 * fps], [0, 1]);

  return (
    <AbsoluteFill style={{ background: colors.black, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${ease(frame, [0, 4 * fps], [1.02, 1.1])})`,
        }}
      >
        <VideoFill clip={clip} />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.06) 45%, rgba(0,0,0,0.82) 100%)",
        }}
      />
      <SafeFrame />
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 94,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 72,
            height: 72,
            borderRadius: 999,
            background: colors.yellow,
            color: colors.black,
            fontSize: 34,
            fontWeight: 950,
            marginBottom: 28,
          }}
        >
          {clip.kicker}
        </div>
        <div
          style={{
            color: colors.cream,
            fontSize: clip.title.length > 14 ? 78 : 96,
            lineHeight: 0.92,
            fontWeight: 950,
            textShadow: "0 18px 60px rgba(0,0,0,0.64)",
          }}
        >
          {clip.title}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 236,
          padding: "22px 28px",
          borderRadius: 24,
          background: "rgba(16,22,16,0.74)",
          color: colors.cream,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 38,
          lineHeight: 1.08,
          fontWeight: 850,
          borderLeft: `10px solid ${colors.yellow}`,
        }}
      >
        {clip.note}
      </div>
    </AbsoluteFill>
  );
};

const SocialIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: colors.green, overflow: "hidden" }}>
      <Video
        src={staticFile("mega-sorgo/mega-05.mp4")}
        trimBefore={0.1 * fps}
        volume={0}
        objectFit="cover"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.58,
          transform: `scale(${ease(frame, [0, 2 * fps], [1.08, 1.0])})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(14,36,23,0.72), rgba(14,36,23,0.26), rgba(14,36,23,0.9))",
        }}
      />
      <SafeFrame />
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 126,
          fontFamily: "Arial, Helvetica, sans-serif",
          color: colors.cream,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: "18px 24px",
            borderRadius: 999,
            background: colors.yellow,
            color: colors.black,
            fontSize: 34,
            fontWeight: 950,
            textTransform: "uppercase",
          }}
        >
          oferta para pecuaria de leite
        </div>
        <div
          style={{
            marginTop: 42,
            fontSize: 104,
            lineHeight: 0.93,
            fontWeight: 950,
            textShadow: "0 18px 60px rgba(0,0,0,0.64)",
          }}
        >
          COCHO VAZIO CUSTA MAIS QUE SEMENTE
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 240,
          fontFamily: "Arial, Helvetica, sans-serif",
          color: colors.cream,
          fontSize: 42,
          fontWeight: 850,
          lineHeight: 1.12,
        }}
      >
        Se a seca aperta, quem tem silagem negocia melhor o custo da dieta.
      </div>
    </AbsoluteFill>
  );
};

const SocialOutro: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: colors.green, overflow: "hidden" }}>
      <Video
        src={staticFile("mega-sorgo/mega-04.mp4")}
        trimBefore={0.9 * 30}
        volume={0}
        objectFit="cover"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.44,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(12,34,22,0.78)",
        }}
      />
      <SafeFrame />
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 152,
          fontFamily: "Arial, Helvetica, sans-serif",
          color: colors.cream,
        }}
      >
        <div
          style={{
            color: colors.yellow,
            fontSize: 42,
            fontWeight: 950,
            textTransform: "uppercase",
          }}
        >
          Mega Sorgo Santa Elisa
        </div>
        <div
          style={{
            marginTop: 38,
            fontSize: 104,
            lineHeight: 0.92,
            fontWeight: 950,
          }}
        >
          QUER REDUZIR DEPENDENCIA DE RACAO?
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 240,
          padding: "30px 34px",
          borderRadius: 30,
          background: colors.cream,
          color: colors.green,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 42,
          lineHeight: 1.08,
          fontWeight: 950,
        }}
      >
        Comente LEITE + sua região. A gente chama para calcular area e silagem.
      </div>
    </AbsoluteFill>
  );
};

export const MegaSorgoSocialModel: React.FC = () => {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("audio/viral-agro-pulse.wav")} volume={0.58} />
      <Series>
        <Series.Sequence durationInFrames={90}>
          <SocialIntro />
        </Series.Sequence>
        {socialCuts.map((clip, index) => (
          <Series.Sequence key={`${clip.src}-${index}`} durationInFrames={90}>
            <SocialClipScene clip={clip} index={index} />
          </Series.Sequence>
        ))}
        <Series.Sequence durationInFrames={120}>
          <SocialOutro />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
