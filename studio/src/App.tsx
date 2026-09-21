import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULTS } from "@policy";
import { BatchTab } from "./batch-tab";
import { LiveTab, type Questions } from "./live-tab";
import { TetrisTab } from "./tetris-tab";
import { RaceTab } from "./race-tab";
import { QuizTab } from "./quiz-tab";
import { BossTab } from "./boss-tab";
import type { Thresholds } from "./parts";

type Item = { msg: string; expect: string; v: any };

export default function App() {
  const [health, setHealth] = useState<{ keyConfigured: boolean } | null>(null);
  const [questions, setQuestions] = useState<Questions>({});
  const [items, setItems] = useState<Item[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [thresholds, setThresholds] = useState<Thresholds>({ ...DEFAULTS });

  useEffect(() => {
    void fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ keyConfigured: false }));
    void fetch("/api/questions").then((r) => r.json()).then(setQuestions).catch(() => {});
    void fetch("/api/dataset").then((r) => r.json()).then((d) => { setItems(d.items ?? []); setFromCache(Boolean(d.fromCache)); }).catch(() => {});
  }, []);

  const liveSamples = items.filter((i) => i.msg).map((i) => ({ msg: i.msg, expect: i.expect }));

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <div>
            <h1 className="text-sm font-semibold">Jev 分诊工作台</h1>
            <p className="text-[11px] text-muted-foreground">state + 5 道判断题 → Jev 概率 → 本地阈值分流</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={health?.keyConfigured ? "secondary" : "destructive"}>
              {health ? (health.keyConfigured ? "密钥已在服务端" : "服务端缺 TYPESAFE_API_KEY") : "检测中"}
            </Badge>
            <Badge variant="outline" className="font-mono">jev-latest</Badge>
            <Badge variant="outline" className="font-mono">{fromCache ? `${items.length} 条判断已缓存` : "无缓存判断"}</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-5">
        <Tabs defaultValue="live">
          <TabsList className="mb-4">
            <TabsTrigger value="live">实时单条</TabsTrigger>
            <TabsTrigger value="batch">批量与阈值</TabsTrigger>
            <TabsTrigger value="tetris">俄罗斯方块</TabsTrigger>
            <TabsTrigger value="race">双人对战直播</TabsTrigger>
            <TabsTrigger value="quiz">判断力对战</TabsTrigger>
            <TabsTrigger value="boss">需求雷达</TabsTrigger>
          </TabsList>
          <TabsContent value="live">
            <LiveTab questions={questions} samples={liveSamples} thresholds={thresholds} />
          </TabsContent>
          <TabsContent value="batch">
            <BatchTab items={items} thresholds={thresholds} setThresholds={setThresholds} />
          </TabsContent>
          <TabsContent value="tetris">
            <TetrisTab />
          </TabsContent>
          <TabsContent value="race">
            <RaceTab />
          </TabsContent>
          <TabsContent value="quiz">
            <QuizTab />
          </TabsContent>
          <TabsContent value="boss">
            <BossTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
