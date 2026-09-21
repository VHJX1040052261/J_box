import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsoleTab } from "./console-tab";
import { StreamTab } from "./stream-tab";
import { WiringTab } from "./wiring-tab";

type Health = { keyConfigured: boolean; model: string; tools: string[]; serverPath: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [tools, setTools] = useState<any[]>([]);

  useEffect(() => {
    void fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ keyConfigured: false, model: "jev-latest", tools: [], serverPath: "" }));
    void fetch("/api/tools").then((r) => r.json()).then(setTools).catch(() => setTools([]));
  }, []);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <div>
            <h1 className="text-sm font-semibold">jev-box 控制台</h1>
            <p className="text-[11px] text-muted-foreground">六个官方用例 → 八个 MCP 工具，任何大模型都能拿来当反射用</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={health?.keyConfigured ? "secondary" : "destructive"}>
              {health ? (health.keyConfigured ? "密钥已在服务端" : "服务端缺 TYPESAFE_API_KEY") : "检测中"}
            </Badge>
            <Badge variant="outline" className="font-mono">{health?.model ?? "jev-latest"}</Badge>
            <Badge variant="outline" className="font-mono">{health?.tools.length ?? 0} 个工具</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-5">
        <Tabs defaultValue="console">
          <TabsList className="mb-4">
            <TabsTrigger value="console">工具台</TabsTrigger>
            <TabsTrigger value="stream">实时调用流</TabsTrigger>
            <TabsTrigger value="wiring">接入方式</TabsTrigger>
          </TabsList>
          <TabsContent value="console">
            {tools.length ? <ConsoleTab tools={tools} /> : <p className="py-10 text-center text-sm text-muted-foreground">正在拉工具清单…</p>}
          </TabsContent>
          <TabsContent value="stream">
            <StreamTab />
          </TabsContent>
          <TabsContent value="wiring">
            <WiringTab serverPath={health?.serverPath ?? ""} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
