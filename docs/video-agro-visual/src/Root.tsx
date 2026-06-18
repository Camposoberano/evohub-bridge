import "./index.css";
import { Composition } from "remotion";
import { AgroVisualStudy } from "./Composition";
import {
  MegaSorgoExamples,
  MegaSorgoSocialModel,
  MegaSorgoViralHook,
} from "./MegaSorgoVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AgroVisualStudy"
        component={AgroVisualStudy}
        durationInFrames={810}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MegaSorgoExamples"
        component={MegaSorgoExamples}
        durationInFrames={990}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MegaSorgoViralHook"
        component={MegaSorgoViralHook}
        durationInFrames={720}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MegaSorgoSocialModel"
        component={MegaSorgoSocialModel}
        durationInFrames={570}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
