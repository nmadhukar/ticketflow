import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle, Users, Clock, BarChart3, Building2 } from "lucide-react";

export default function Landing() {
  const features = [
    {
      icon: <CheckCircle className="h-8 w-8 text-blue-600" />,
      title: "Task Management",
      description:
        "Create, assign, and track tasks with ease. Organize by priority, category, and status.",
    },
    {
      icon: <Users className="h-8 w-8 text-green-600" />,
      title: "Team Collaboration",
      description:
        "Work together seamlessly with team assignments, comments, and real-time updates.",
    },
    {
      icon: <Clock className="h-8 w-8 text-orange-600" />,
      title: "Due Date Tracking",
      description:
        "Never miss a deadline with due date reminders and priority indicators.",
    },
    {
      icon: <BarChart3 className="h-8 w-8 text-purple-600" />,
      title: "Progress Analytics",
      description:
        "Track team performance and project progress with detailed analytics and reports.",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <CheckCircle className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">TaskFlow</h1>
                <p className="text-sm text-slate-500">Community Platform</p>
              </div>
            </div>
            <Button
              onClick={() => (window.location.href = "/login")}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Sign In
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold text-slate-900 mb-6">
            Streamline Your Team's
            <span className="text-blue-600 block">Task Management</span>
          </h1>
          <p className="text-xl text-slate-600 mb-8 max-w-3xl mx-auto">
            TaskFlow helps community teams organize, track, and complete
            projects efficiently. From bug fixes to feature requests, manage
            everything in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              onClick={() => (window.location.href = "/login")}
              className="bg-blue-600 hover:bg-blue-700 text-lg px-8 py-3"
            >
              Get Started Free
            </Button>
            {/** SSO temporarily disabled
            <Button
              size="lg"
              variant="outline"
              onClick={() => (window.location.href = "/api/auth/microsoft")}
              className="text-lg px-8 py-3"
            >
              <Building2 className="mr-2 h-5 w-5" />
              Sign in with Microsoft 365
            </Button>
            */}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">
              Everything you need to manage tasks
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Powerful features designed for modern teams working on community
              projects and educational resources.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="text-center border-slate-200 hover:shadow-lg transition-shadow"
              >
                <CardHeader>
                  <div className="flex justify-center mb-4">{feature.icon}</div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-slate-600">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-blue-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to boost your team's productivity?
          </h2>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Join thousands of teams already using TaskFlow to manage their
            educational resources and community projects.
          </p>
          <Button
            size="lg"
            onClick={() => (window.location.href = "/login")}
            className="bg-white text-blue-600 hover:bg-slate-100 text-lg px-8 py-3"
          >
            Start Your Free Trial
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center space-x-3 mb-8">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <CheckCircle className="text-white w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold">TaskFlow</h3>
              <p className="text-sm text-slate-400">Community Platform</p>
            </div>
          </div>
          <div className="text-center text-slate-400">
            <p>&copy; 2024 TaskFlow. Built for community collaboration.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
