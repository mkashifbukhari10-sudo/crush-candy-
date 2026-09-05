import { Outlet } from "react-router";

export default function CustomerPortalLayout() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fff7fb",
        color: "#30212a",
        fontFamily: "Arial, sans-serif",
        padding: "clamp(24px, 7vw, 72px) 20px",
      }}
    >
      <main
        style={{
          maxWidth: 620,
          margin: "0 auto",
          background: "white",
          border: "1px solid #eadde4",
          borderRadius: 16,
          padding: "clamp(24px, 5vw, 48px)",
          boxShadow: "0 16px 45px rgba(68, 35, 53, 0.08)",
        }}
      >
        <p style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Crush Candy Supplies
        </p>
        <Outlet />
      </main>
    </div>
  );
}
