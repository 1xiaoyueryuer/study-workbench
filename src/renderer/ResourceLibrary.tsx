import { useEffect, useState, type CSSProperties } from "react";
import { useDropzone } from "react-dropzone";
import { Button, Modal } from "./components/ui";
import type { PageActions } from "./pages/Shop";
type Course = { id: string; name: string; resource_count: number };
type Resource = {
  id: string;
  title: string;
  course_id: string;
  course_name: string;
  kind: string;
  original_name: string;
  note: string;
};
export function ResourceLibrary({
  call,
  run,
  busy,
  datasetId,
}: PageActions & { datasetId: string }) {
  const [courses, setCourses] = useState<Course[]>([]),
    [course, setCourse] = useState<Course | null>(null),
    [rows, setRows] = useState<Resource[]>([]),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [bookPage, setBookPage] = useState(0),
    [dialog, setDialog] = useState<
      "create" | "rename" | "delete" | "link" | null
    >(null),
    [edit, setEdit] = useState<Resource | null>(null),
    [message, setMessage] = useState("");
  const refresh = async () => {
    setCourses(await call("listCourses"));
    setRows(
      await call("listResources", {
        offset,
        search,
        ...(course && !search ? { course: course.id } : {}),
      }),
    );
  };
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [datasetId, course?.id, search, offset]);
  const imported = (
    r: {
      count: number;
      results?: { name: string; status: string; reason?: string }[];
    } | null,
  ) =>
    setMessage(
      r
        ? `${r.count} 份已导入${
            r.results
              ?.filter((v) => v.status !== "imported")
              .map(
                (v) =>
                  `；${v.name}：${v.status === "duplicate" ? "已在课程中" : v.status === "cancelled" ? "已取消" : v.reason}`,
              )
              .join("") ?? ""
          }`
        : "",
    );
  const { getRootProps, isDragActive } = useDropzone({
    getFilesFromEvent: async (event) => {
      if ("dataTransfer" in event && event.dataTransfer) {
        if (event.type !== "drop") return Array.from(event.dataTransfer.items);
        return Array.from(event.dataTransfer.files);
      }
      if ("target" in event && event.target instanceof HTMLInputElement)
        return Array.from(event.target.files ?? []);
      return [];
    },
    onDropRejected: (rejections) =>
      setMessage(
        rejections.map((r) => `${r.file.name}：每批最多100个文件`).join("；"),
      ),
    noClick: true,
    noKeyboard: true,
    disabled: !course,
    maxFiles: 100,
    onDrop: (files) => {
      if (!course) return;
      void run(async () => {
        const r = await window.workbench.importDroppedFiles(
          files,
          course.id,
          crypto.randomUUID(),
          datasetId,
        );
        if (!r.ok) throw new Error(r.error.message);
        imported(r.value);
        await refresh();
      });
    },
  });
  return (
    <section className="library">
      <header className="library-heading">
        <h1>{course?.name ?? "学习资料"}</h1>
        <input
          aria-label="搜索全部课程和资料"
          placeholder="搜索课程或资料"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
            setBookPage(0);
          }}
        />
        {course ? (
          <div className="button-row">
            <Button
              variant="outline"
              onClick={() => {
                setCourse(null);
                setOffset(0);
              }}
            >
              返回书架
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  imported(
                    await call("chooseAndImportFiles", { courseId: course.id }),
                  );
                  await refresh();
                })
              }
            >
              添加资料
            </Button>
            <details>
              <summary>更多</summary>
              <button onClick={() => setDialog("link")}>添加网页链接</button>
              <button onClick={() => setDialog("rename")}>重命名课程</button>
              <button onClick={() => setDialog("delete")}>删除课程</button>
            </details>
          </div>
        ) : (
          <Button onClick={() => setDialog("create")}>添加课程</Button>
        )}
      </header>
      {message && (
        <p className="import-summary" role="status">
          {message}
        </p>
      )}
      {!course && (
        <>
          <div className="bookshelf">
            {courses
              .filter(
                (c) =>
                  !search ||
                  c.name.toLowerCase().includes(search.toLowerCase()),
              )
              .slice(bookPage * 30, bookPage * 30 + 30)
              .map((c, i) => (
                <button
                  className="course-book"
                  key={c.id}
                  title={c.name}
                  style={
                    {
                      "--book-height": `${194 + (i % 4) * 11}px`,
                    } as CSSProperties
                  }
                  onClick={() => {
                    setCourse(c);
                    setSearch("");
                    setOffset(0);
                  }}
                >
                  <span className="book-cover" />
                  <span className="book-spine">
                    <span>{c.name}</span>
                    <small>{c.resource_count ?? 0}</small>
                  </span>
                </button>
              ))}
          </div>
          <div className="pager">
            <button
              disabled={!bookPage}
              onClick={() => setBookPage(bookPage - 1)}
            >
              上一页
            </button>
            <span>{bookPage + 1}</span>
            <button
              disabled={
                (bookPage + 1) * 30 >=
                courses.filter((c) => !search || c.name.includes(search)).length
              }
              onClick={() => setBookPage(bookPage + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
      {(course || search) && (
        <div
          {...getRootProps({
            className: `course-content ${isDragActive ? "drag-active" : ""}`,
          })}
        >
          {!rows.length && (
            <p className="library-empty">
              {course ? "将 PDF 或文档拖到这里" : "没有匹配资料"}
            </p>
          )}
          {rows.map((r) => (
            <article className="course-file" key={r.id}>
              <button
                className="file-title"
                onClick={() =>
                  void run(async () => {
                    await call("openResource", { id: r.id });
                  })
                }
              >
                <span className="file-mark">
                  {r.kind === "url"
                    ? "↗"
                    : r.original_name?.split(".").pop()?.toUpperCase()}
                </span>
                <span>
                  {r.title}
                  <small>
                    {r.kind === "url" ? "网页 · 需要联网" : r.course_name}
                  </small>
                </span>
              </button>
              <Button variant="ghost" onClick={() => setEdit(r)}>
                管理
              </Button>
            </article>
          ))}
          {(offset > 0 || rows.length === 50) && (
            <div className="pager">
              <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
                上一页
              </button>
              <button
                disabled={rows.length < 50}
                onClick={() => setOffset(offset + 50)}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={
          {
            create: "添加课程",
            rename: "重命名课程",
            delete: "删除课程",
            link: "添加网页链接",
          }[dialog ?? "create"]
        }
        description={
          dialog === "delete"
            ? `此课程有 ${courses.find((c) => c.id === course?.id)?.resource_count ?? 0} 份资料，默认移至未归档。`
            : ""
        }
      >
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              if (dialog === "create")
                await call("createCourse", { name: String(f.get("name")) });
              if (dialog === "rename") {
                const name = String(f.get("name"));
                await call("renameCourse", { id: course!.id, name });
                setCourse({ ...course!, name });
              }
              if (dialog === "delete") {
                await call("deleteCourse", {
                  id: course!.id,
                  removeResources: f.get("remove") === "on",
                });
                setCourse(null);
              }
              if (dialog === "link")
                await call("saveLink", {
                  title: String(f.get("name")),
                  url: String(f.get("url")),
                  courseId: course!.id,
                  note: "",
                });
              setDialog(null);
              await refresh();
            });
          }}
        >
          {dialog === "delete" ? (
            <label>
              <input type="checkbox" name="remove" />
              同时移除资料引用（不会删除原始文件）
            </label>
          ) : (
            <label>
              {dialog === "link" ? "网页标题" : "课程名"}
              <input
                name="name"
                maxLength={160}
                required
                defaultValue={dialog === "rename" ? course?.name : ""}
              />
            </label>
          )}
          {dialog === "link" && (
            <label>
              网址
              <input name="url" type="url" required />
            </label>
          )}
          <Button disabled={busy}>确认</Button>
        </form>
      </Modal>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="管理资料"
        description="修改显示标题或移动课程。"
      >
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              await call("renameResource", {
                id: edit!.id,
                title: String(f.get("title")),
              });
              await call("moveResource", {
                id: edit!.id,
                courseId: String(f.get("course")),
              });
              setEdit(null);
              await refresh();
            });
          }}
        >
          <label>
            显示标题
            <input name="title" required defaultValue={edit?.title} />
          </label>
          <label>
            所属课程
            <select name="course" defaultValue={edit?.course_id}>
              {courses.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={busy}>保存</Button>
        </form>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await call("deleteResource", { id: edit!.id });
              setEdit(null);
              await refresh();
            })
          }
        >
          移除此资料引用
        </Button>
      </Modal>
    </section>
  );
}
