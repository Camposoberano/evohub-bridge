import {
  AbsoluteFill,
  Easing,
  interpolate,
  Series,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type SceneProps = {
  label: string;
  headline: string;
  subhead: string;
  cta: string;
  variant: "corn" | "silage" | "compare";
};

const palette = {
  green: "#254F35",
  greenDeep: "#102D1E",
  leaf: "#3F7A43",
  yellow: "#E0A51B",
  soil: "#7A4B2A",
  cream: "#F7F0DC",
  red: "#C7352B",
  white: "#FFFFFF",
};

const fit = (
  frame: number,
  input: [number, number],
  output: [number, number],
) =>
  interpolate(frame, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const GrainField: React.FC<{ progress: number; variant: SceneProps["variant"] }> = ({
  progress,
  variant,
}) => {
  const rows = Array.from({ length: 8 });
  const color = variant === "corn" ? palette.yellow : "#B2672E";
  const alt = variant === "compare" ? "#D29A35" : color;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background:
          variant === "silage"
            ? `linear-gradient(180deg, ${palette.greenDeep} 0%, #173B24 50%, #26170F 100%)`
            : `linear-gradient(180deg, #6FA8D8 0%, #CDE7F4 38%, ${palette.green} 39%, ${palette.greenDeep} 100%)`,
      }}
    >
      {variant !== "silage" ? (
        <>
          <div
            style={{
              position: "absolute",
              left: -100,
              right: -100,
              top: 710,
              height: 650,
              background: `linear-gradient(180deg, ${palette.leaf}, ${palette.greenDeep})`,
              transform: `skewY(-7deg) translateY(${progress * -35}px)`,
              borderTop: "8px solid rgba(255,255,255,0.22)",
            }}
          />
          {rows.map((_, row) => (
            <div
              key={row}
              style={{
                position: "absolute",
                left: -120,
                top: 780 + row * 96,
                width: 1320,
                height: 26,
                transform: `rotate(-7deg) translateX(${progress * 36}px)`,
                display: "flex",
                gap: 28,
                opacity: 0.88 - row * 0.045,
              }}
            >
              {Array.from({ length: 18 }).map((__, i) => (
                <div
                  key={i}
                  style={{
                    width: 58,
                    height: 26,
                    borderRadius: 999,
                    background: i % 2 ? color : alt,
                    boxShadow: "0 8px 16px rgba(0,0,0,0.22)",
                  }}
                />
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          <div
            style={{
              position: "absolute",
              left: 80,
              right: 80,
              top: 650,
              height: 670,
              borderRadius: 36,
              background: `linear-gradient(135deg, #88A856 0%, #A4B85F 40%, #5A2F20 100%)`,
              boxShadow: "0 50px 100px rgba(0,0,0,0.38)",
              transform: `translateY(${progress * -28}px)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 105,
              right: 105,
              top: 690,
              height: 120,
              borderRadius: 28,
              background: "rgba(255,255,255,0.14)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 130,
              top: 1120,
              width: 390,
              height: 160,
              borderRadius: 80,
              background: "#5B2D1F",
              transform: `rotate(-8deg) translateX(${progress * 24}px)`,
              boxShadow: "0 28px 80px rgba(0,0,0,0.4)",
            }}
          />
        </>
      )}
    </div>
  );
};

const CowAndTrough: React.FC<{ frame: number; emphasis?: boolean }> = ({
  frame,
  emphasis = false,
}) => {
  const bob = Math.sin(frame / 12) * 5;

  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        right: 80,
        bottom: 160,
        height: 280,
        transform: `translateY(${bob}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 88,
          borderRadius: 18,
          background: `linear-gradient(180deg, ${palette.soil}, #3D2417)`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
        }}
      />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 80 + i * 270,
            bottom: 70 + (i % 2) * 12,
            width: 180,
            height: 92,
            borderRadius: 54,
            background: emphasis && i === 1 ? palette.cream : "#E8E0C8",
            boxShadow: "inset -24px -10px 0 rgba(0,0,0,0.12)",
          }}
        >
          <div
            style={{
              position: "absolute",
              right: -40,
              top: 20,
              width: 74,
              height: 58,
              borderRadius: 40,
              background: "inherit",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 36,
              top: 26,
              width: 44,
              height: 28,
              borderRadius: 30,
              background: "#2B241E",
              opacity: 0.55,
            }}
          />
        </div>
      ))}
    </div>
  );
};

const SplitComparison: React.FC<{ frame: number }> = ({ frame }) => {
  const { fps } = useVideoConfig();
  const left = fit(frame, [0.2 * fps, 1.4 * fps], [-120, 0]);
  const right = fit(frame, [0.4 * fps, 1.6 * fps], [120, 0]);

  return (
    <AbsoluteFill style={{ background: palette.greenDeep }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        <div
          style={{
            transform: `translateX(${left}px)`,
            background: "linear-gradient(180deg, #77B255 0%, #2F6B3C 100%)",
          }}
        />
        <div
          style={{
            transform: `translateX(${right}px)`,
            background: "linear-gradient(180deg, #E8C45B 0%, #7A4B2A 100%)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 620,
          left: "50%",
          width: 12,
          height: 860,
          transform: "translateX(-50%)",
          borderRadius: 999,
          background: "rgba(255,255,255,0.82)",
        }}
      />
      <CowAndTrough frame={frame} emphasis />
    </AbsoluteFill>
  );
};

const Scene: React.FC<SceneProps> = ({ label, headline, subhead, cta, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = fit(frame, [0, 5.6 * fps], [0, 1]);
  const titleY = fit(frame, [0.2 * fps, 1.1 * fps], [80, 0]);
  const titleOpacity = fit(frame, [0.2 * fps, 0.8 * fps], [0, 1]);
  const cardScale = spring({
    frame: frame - 18,
    fps,
    config: { damping: 16, stiffness: 120 },
  });

  return (
    <AbsoluteFill style={{ fontFamily: "Inter, Arial, sans-serif" }}>
      {variant === "compare" ? (
        <SplitComparison frame={frame} />
      ) : (
        <>
          <GrainField progress={progress} variant={variant} />
          <CowAndTrough frame={frame} emphasis={variant === "corn"} />
        </>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(12,28,18,0.72) 0%, rgba(12,28,18,0.18) 42%, rgba(12,28,18,0.82) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 128,
          left: 74,
          right: 74,
          transform: `translateY(${titleY}px)`,
          opacity: titleOpacity,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: "18px 26px",
            borderRadius: 999,
            background: variant === "silage" ? palette.red : palette.yellow,
            color: variant === "silage" ? palette.white : "#221709",
            fontSize: 36,
            fontWeight: 900,
            letterSpacing: 0,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        <div
          style={{
            marginTop: 44,
            fontSize: 128,
            lineHeight: 0.92,
            fontWeight: 950,
            color: palette.white,
            letterSpacing: 0,
            textShadow: "0 16px 48px rgba(0,0,0,0.48)",
          }}
        >
          {headline}
        </div>
        <div
          style={{
            marginTop: 34,
            maxWidth: 850,
            fontSize: 48,
            lineHeight: 1.13,
            fontWeight: 750,
            color: palette.cream,
            textShadow: "0 8px 28px rgba(0,0,0,0.5)",
          }}
        >
          {subhead}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 74,
          right: 74,
          bottom: 72,
          padding: "30px 34px",
          borderRadius: 30,
          background: "rgba(247, 240, 220, 0.94)",
          color: palette.greenDeep,
          fontSize: 40,
          fontWeight: 850,
          transform: `scale(${Math.min(1, cardScale)})`,
          transformOrigin: "left bottom",
          boxShadow: "0 28px 80px rgba(0,0,0,0.32)",
        }}
      >
        {cta}
      </div>
    </AbsoluteFill>
  );
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fit(frame, [0, 0.8 * fps], [0, 1]);
  const y = fit(frame, [0, 1.1 * fps], [80, 0]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${palette.greenDeep} 0%, ${palette.green} 58%, ${palette.soil} 100%)`,
        color: palette.white,
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -180,
          top: 720,
          width: 1440,
          height: 420,
          transform: "rotate(-11deg)",
          background: "rgba(224,165,27,0.2)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 74,
          right: 74,
          top: 230,
          opacity,
          transform: `translateY(${y}px)`,
        }}
      >
        <div
          style={{
            color: palette.yellow,
            fontSize: 42,
            fontWeight: 900,
            textTransform: "uppercase",
          }}
        >
          estudo visual
        </div>
        <div
          style={{
            marginTop: 34,
            fontSize: 116,
            lineHeight: 0.94,
            fontWeight: 950,
            letterSpacing: 0,
          }}
        >
          3 temas para testar no agro
        </div>
        <div
          style={{
            marginTop: 42,
            fontSize: 44,
            lineHeight: 1.18,
            maxWidth: 860,
            color: palette.cream,
            fontWeight: 700,
          }}
        >
          Pecuária, silagem e decisão de compra para Sul/Sudeste.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({
    frame: frame - 12,
    fps,
    config: { damping: 18, stiffness: 110 },
  });

  return (
    <AbsoluteFill
      style={{
        background: palette.greenDeep,
        color: palette.white,
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <GrainField progress={0.8} variant="compare" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(16,45,30,0.82)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 74,
          right: 74,
          top: 190,
          transform: `scale(${Math.min(1, scale)})`,
          transformOrigin: "left top",
        }}
      >
        <div
          style={{
            fontSize: 94,
            lineHeight: 0.98,
            fontWeight: 950,
          }}
        >
          Próximo passo:
        </div>
        {[
          "gerar thumbnails",
          "gravar 3 Reels",
          "medir views e comentários",
        ].map((item, index) => (
          <div
            key={item}
            style={{
              marginTop: 42,
              display: "flex",
              alignItems: "center",
              gap: 28,
              fontSize: 48,
              fontWeight: 850,
              color: palette.cream,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: index === 0 ? palette.yellow : "rgba(255,255,255,0.14)",
                color: index === 0 ? palette.greenDeep : palette.white,
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
          left: 74,
          right: 74,
          bottom: 90,
          fontSize: 38,
          lineHeight: 1.18,
          color: palette.cream,
          fontWeight: 700,
        }}
      >
        Campo Soberano / Super Sorgo - conteúdo visual para testar demanda.
      </div>
    </AbsoluteFill>
  );
};

export const AgroVisualStudy: React.FC = () => {
  return (
    <Series>
      <Series.Sequence durationInFrames={90}>
        <Intro />
      </Series.Sequence>
      <Series.Sequence durationInFrames={180}>
        <Scene
          label="dor econômica"
          headline="MILHO CARO?"
          subhead="A margem do leite sente primeiro no cocho."
          cta="Testar vídeo: custo do milho x volumoso planejado"
          variant="corn"
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={180}>
        <Scene
          label="silagem"
          headline="SILAGEM RUIM?"
          subhead="O prejuízo começa antes de virar leite ou arroba."
          cta="Testar vídeo: 3 erros que fazem o silo perder dinheiro"
          variant="silage"
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={180}>
        <Scene
          label="comparativo"
          headline="SORG0 X MILHO"
          subhead="Qual cultura fecha melhor a conta no Sul/Sudeste?"
          cta="Testar vídeo: comente sua região para calcular"
          variant="compare"
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={180}>
        <Outro />
      </Series.Sequence>
    </Series>
  );
};
